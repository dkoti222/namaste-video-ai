"use client";

import Link from "next/link";
import { useEffect, useMemo } from "react";
import { estimateSeconds, cueIndex, validatePlanV2, type FieldIssue, type PlanV2, type SceneV2 } from "@/lib/plan";
import { CreateStoryboardStatus, useCreateStoryboard } from "./create-storyboard";
import { SaveIndicator, useDraftAutosave, type DraftDto } from "./draft-autosave";
import { ProjectSteps } from "./project-steps";
import { ScenePreview } from "./scene-preview";
import { ApprovePanel, HistoryPanel, RevisePanel, type StoryboardSummary } from "./storyboard-actions";

// Storyboard review (screens 08 / 20): scene navigator, schematic scene cards, editable spoken narration and
// on-screen text, estimated timing and live validation. Edits autosave into the working draft (editablePlan).
// Approval, generation and conversational revisions are later features and are clearly marked as such.

const WPS = 2.5;
const words = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, "0")}`;
const count = (text: string) => [...text].length;

type Flow = { steps: { id: string; label: string }[]; edges: unknown[] };
type Comparison = { left: { heading: string; points: string[] }; right: { heading: string; points: string[] } };
type Labels = { labels: string[] };

function issuesByScene(issues: FieldIssue[]) {
  const map = new Map<number, FieldIssue[]>();
  const general: FieldIssue[] = [];
  for (const issue of issues) {
    const match = /^scenes\.(\d+)/.exec(issue.path);
    if (match) map.set(Number(match[1]), [...(map.get(Number(match[1])) ?? []), issue]);
    else general.push(issue);
  }
  return { map, general };
}

function TextField({ id, label, value, max, onChange, multiline }: { id: string; label: string; value: string; max: number; onChange: (v: string) => void; multiline?: boolean }) {
  const over = count(value) > max;
  return (
    <div className="field sb-field">
      <label htmlFor={id}>{label}</label>
      {multiline ? (
        <textarea id={id} rows={4} value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={over} />
      ) : (
        <input id={id} value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={over} />
      )}
      <p className="hint field-hint"><span /><span className={over ? "over" : ""}>{count(value)}/{max}</span></p>
    </div>
  );
}

function OnScreenText({ scene, update }: { scene: SceneV2; update: (data: Record<string, unknown>) => void }) {
  const { component, data } = scene.visual;
  if (component === "flow") {
    const flow = data as Flow;
    return (
      <fieldset className="sb-onscreen">
        <legend>On-screen steps</legend>
        {flow.steps.map((step, i) => (
          <input
            key={step.id}
            aria-label={`Step ${i + 1}`}
            value={step.label}
            onChange={(e) => update({ ...flow, steps: flow.steps.map((s, j) => (j === i ? { ...s, label: e.target.value } : s)) })}
          />
        ))}
      </fieldset>
    );
  }
  if (component === "comparison") {
    const c = data as Comparison;
    const side = (key: "left" | "right") => (
      <div className="sb-side" key={key}>
        <input aria-label={`${key} heading`} value={c[key].heading} onChange={(e) => update({ ...c, [key]: { ...c[key], heading: e.target.value } })} />
        {c[key].points.map((point, i) => (
          <input
            key={i}
            aria-label={`${key} point ${i + 1}`}
            value={point}
            onChange={(e) => update({ ...c, [key]: { ...c[key], points: c[key].points.map((p, j) => (j === i ? e.target.value : p)) } })}
          />
        ))}
      </div>
    );
    return (
      <fieldset className="sb-onscreen sb-compare">
        <legend>On-screen comparison</legend>
        {side("left")}
        {side("right")}
      </fieldset>
    );
  }
  if (component === "binary-search") {
    return <p className="hint">Search numbers and steps are computed from the algorithm, so they can’t be edited here.</p>;
  }
  const labels = data as Labels;
  return (
    <fieldset className="sb-onscreen">
      <legend>On-screen labels</legend>
      {labels.labels.map((text, i) => (
        <input key={i} aria-label={`Label ${i + 1}`} value={text} onChange={(e) => update({ ...labels, labels: labels.labels.map((l, j) => (j === i ? e.target.value : l)) })} />
      ))}
    </fieldset>
  );
}

export function StoryboardEditor({
  project,
  draft,
  activeJob,
  source,
  approved,
  versions,
  hasVideo = false,
}: {
  project: { id: string; title: string };
  draft: DraftDto;
  activeJob: { id: string; type: string } | null;
  source: { id: string; contentHash: string } | null;
  approved: { at: string; content: PlanV2 } | null;
  versions: StoryboardSummary[];
  hasVideo?: boolean;
}) {
  const { controller, state } = useDraftAutosave(project.id, draft);
  const create = useCreateStoryboard(project.id, controller, activeJob, () => window.location.reload());
  const plan = state.local.editablePlan as PlanV2;
  const validation = useMemo(() => validatePlanV2(plan), [plan]);
  const grouped = useMemo(() => issuesByScene(validation.issues), [validation]);
  const total = estimateSeconds(plan);
  const lengthOff = validation.warnings.some((w) => w.code === "DURATION_ESTIMATE");
  // Approved means the working storyboard still equals the immutable approved snapshot.
  const approvedState = approved ? { at: approved.at, matches: JSON.stringify(approved.content) === JSON.stringify(plan) } : null;
  const blockedReason = validation.issues.length
    ? "Fix the issues above before approving."
    : lengthOff
      ? "Adjust the narration so the video lasts 60–90 seconds before approving."
      : state.status === "conflict" || state.status === "failed"
        ? "Your latest edits must be saved before approving."
        : null;

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (controller.snapshot.status !== "saved") event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [controller]);

  const setScene = (index: number, patch: Partial<SceneV2>) =>
    controller.edit({ editablePlan: { ...plan, scenes: plan.scenes.map((s, i) => (i === index ? { ...s, ...patch } : s)) } });

  return (
    <div className="sb-page">
      <div className="idea-top">
        <Link href="/videos" className="text-link">← My videos</Link>
        <SaveIndicator state={state} onRetry={() => void controller.flush()} />
      </div>
      <h1 className="idea-title">{plan.title}</h1>
      <ProjectSteps projectId={project.id} current="storyboard" storyboardReady videoReady={hasVideo} beforeNavigate={() => controller.flush()} />
      <CreateStoryboardStatus flow={create} />
      {state.status === "conflict" && (
        <div className="notice notice--error" role="alert">
          <strong>This storyboard changed in another tab.</strong>
          <p>Your edits haven’t been saved. Reload to see the latest version.</p>
        </div>
      )}
      {state.status === "failed" && (
        <div className="notice notice--error" role="alert"><strong>Your latest edits haven’t reached the server.</strong><p>{state.error} Keep this tab open and retry.</p></div>
      )}

      <div className="sb-summary">
        <div>
          <strong>{plan.scenes.length} scenes · estimated {clock(total)}</strong>
          <span className="muted"> · target 1:00–1:30 · timing is an estimate until narration is recorded</span>
        </div>
        <div className={validation.issues.length || lengthOff ? "sb-check sb-check--issues" : "sb-check"} role="status">
          {validation.issues.length
            ? `${validation.issues.length} issue${validation.issues.length === 1 ? "" : "s"} to fix before approval`
            : lengthOff
              ? "Length outside the 60–90 second target"
              : approvedState?.matches
                ? "Approved"
                : approvedState
                  ? "Changed since approval"
                  : "Ready for approval"}
        </div>
      </div>
      {validation.warnings.map((w) => <p key={w.code} className="notice">{w.message}</p>)}
      {grouped.general.length > 0 && (
        <div className="notice notice--error" role="alert">{grouped.general.map((i) => <p key={i.path + i.code}>{i.message}</p>)}</div>
      )}

      <div className="sb-layout">
        <nav className="sb-nav" aria-label="Scenes">
          <ol>
            {plan.scenes.map((scene, index) => (
              <li key={scene.id}>
                <a href={`#scene-${scene.id}`}>
                  <span className="sb-num">{index + 1}</span>
                  <span className="sb-nav-title">{scene.title || "Untitled scene"}</span>
                  {grouped.map.has(index) && <span className="sb-dot" aria-label="Has issues" />}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <aside className="sb-side">
          <RevisePanel projectId={project.id} plan={plan} controller={controller} source={source} activeJob={activeJob} />
          <HistoryPanel projectId={project.id} versions={versions} currentId={source?.id ?? null} controller={controller} />
        </aside>

        <div className="sb-scenes">
          {plan.scenes.map((scene, index) => {
            const issues = grouped.map.get(index) ?? [];
            const seconds = Math.max(1, Math.round(words(scene.narration) / WPS));
            return (
              <article key={scene.id} id={`scene-${scene.id}`} className="panel sb-card" aria-labelledby={`scene-${scene.id}-h`}>
                <header className="sb-card-head">
                  <h2 id={`scene-${scene.id}-h`}>Scene {index + 1}</h2>
                  <span className="muted">~{seconds}s · {words(scene.narration)} words</span>
                </header>
                <div className="sb-card-body">
                  <ScenePreview scene={scene} />
                  <div className="sb-fields">
                    <TextField id={`kicker-${scene.id}`} label="Kicker" value={scene.kicker} max={35} onChange={(kicker) => setScene(index, { kicker })} />
                    <TextField id={`title-${scene.id}`} label="On-screen title" value={scene.title} max={65} onChange={(title) => setScene(index, { title })} />
                    <TextField id={`narration-${scene.id}`} label="Spoken narration" value={scene.narration} max={1400} multiline onChange={(narration) => setScene(index, { narration })} />
                    <ul className="sb-cues">
                      {scene.events.map((event) => {
                        const found = cueIndex(scene.narration, event.cue.phrase, event.cue.occurrence) >= 0;
                        return (
                          <li key={event.id} className={found ? "" : "sb-cue--missing"}>
                            {found ? "Visual cue" : "Missing cue"}: “{event.cue.phrase}”
                            {!found && " — keep these words in the narration so the visual appears at the right moment."}
                          </li>
                        );
                      })}
                    </ul>
                    <OnScreenText scene={scene} update={(data) => setScene(index, { visual: { ...scene.visual, data } })} />
                  </div>
                </div>
                {issues.length > 0 && (
                  <ul className="sb-issues" role="alert">
                    {issues.map((issue) => <li key={issue.path + issue.code}>{issue.message}</li>)}
                  </ul>
                )}
              </article>
            );
          })}
        </div>
      </div>

      <ApprovePanel projectId={project.id} controller={controller} ready={blockedReason === null && !activeJob} blockedReason={activeJob ? "Another task is running for this video." : blockedReason} approved={approvedState} hasVideo={hasVideo} />
      <div className="sb-more">
        <button type="button" className="button button--secondary button--small" onClick={() => void create.start()} disabled={create.state === "creating" || create.state === "applying"}>
          {create.state === "creating" || create.state === "applying" ? "Creating…" : "Create a new storyboard"}
        </button>
        <span className="hint">Starts over from your idea. Earlier versions stay in history.</span>
      </div>
    </div>
  );
}
