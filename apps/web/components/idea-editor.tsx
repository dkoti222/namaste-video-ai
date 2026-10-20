"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { apiFetch, ClientApiError } from "@/lib/api-client";
import type { DraftAutosave, DraftFields } from "@/lib/autosave";
import { CreateStoryboardStatus, useCreateStoryboard } from "./create-storyboard";
import { fieldsOf, SaveIndicator, useDraftAutosave, type DraftDto } from "./draft-autosave";
import { ProjectSteps } from "./project-steps";

// Idea step (screens 07 / 19): topic, optional audience and notes, narrator, autosave with honest status and
// conflict resolution, and Gemini topic suggestions through the brainstorm job.

type Voice = { preset: string; label: string; accent: string; testOnly: boolean; sampleUrl: string | null };
type Suggestion = { id: string; topic: string; angle: string; takeaway: string };
type JobDto = { id: string; state: string; result: { kind: string; suggestions?: Suggestion[] } | null; error: { message: string; retryable: boolean } | null };

const LIMITS = { topic: 2000, audience: 200, notes: 20000 };
const count = (text: string) => [...text].length;

export function IdeaEditor({
  project,
  draft,
  voices,
  initialIdeas,
  activeJob,
  ideasEnabled,
}: {
  project: { id: string; title: string };
  draft: DraftDto;
  voices: Voice[];
  initialIdeas: Suggestion[];
  activeJob: { id: string; type: string } | null;
  ideasEnabled: boolean;
}) {
  const { controller, state } = useDraftAutosave(project.id, draft);
  const storyboardPath = `/projects/${project.id}/storyboard`;
  const create = useCreateStoryboard(project.id, controller, activeJob, () => window.location.assign(storyboardPath));
  const hasStoryboard = state.local.editablePlan !== null && state.local.editablePlan !== undefined;
  const local = state.local;
  const [showDetails, setShowDetails] = useState(Boolean(draft.audience || draft.notes));
  const [server, setServer] = useState<{ revision: number; fields: DraftFields } | null>(null);
  const [comparing, setComparing] = useState(false);

  // Warn before leaving with edits that have not reached the server.
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (controller.snapshot.status !== "saved") event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [controller]);

  async function fetchServerDraft() {
    const { data } = await apiFetch<DraftDto>(`/api/projects/${project.id}/draft`);
    const next = { revision: data.revision, fields: fieldsOf(data) };
    setServer(next);
    return next;
  }
  useEffect(() => {
    if (state.status === "conflict") void fetchServerDraft().catch(() => undefined);
    else {
      setServer(null);
      setComparing(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status]);

  const edit = (changes: Partial<DraftFields>) => controller.edit(changes);
  const topicMissing = local.topic.trim().length === 0;

  return (
    <div className="idea-page">
      <div className="idea-top">
        <Link href="/videos" className="text-link">← My videos</Link>
        <SaveIndicator state={state} onRetry={() => void controller.flush()} />
      </div>
      <h1 className="idea-title">{project.title}</h1>
      <ProjectSteps projectId={project.id} current="idea" storyboardReady={hasStoryboard} beforeNavigate={() => controller.flush()} />
      <CreateStoryboardStatus flow={create} />

      {state.status === "conflict" && (
        <div className="notice notice--error conflict" role="alert">
          <strong>This draft changed in another tab.</strong>
          <p>Your text below hasn’t been saved. Choose which version to keep.</p>
          <div className="actions">
            <button type="button" className="button button--secondary button--small" onClick={() => setComparing((v) => !v)} disabled={!server}>
              {comparing ? "Hide comparison" : "Compare versions"}
            </button>
            <button type="button" className="button button--primary button--small" disabled={!server} onClick={async () => { const s = await fetchServerDraft(); await controller.reapply(s); }}>
              Keep my version
            </button>
            <button type="button" className="button button--secondary button--small" disabled={!server} onClick={async () => controller.reload(await fetchServerDraft())}>
              Use the other version
            </button>
          </div>
          {comparing && server && (
            <dl className="compare">
              {(["topic", "audience", "notes"] as const).map((key) =>
                server.fields[key] !== local[key] ? (
                  <div key={key}>
                    <dt>{key[0].toUpperCase() + key.slice(1)}</dt>
                    <dd><span className="compare-label">Other tab</span>{server.fields[key] || "(empty)"}</dd>
                    <dd><span className="compare-label">Yours</span>{local[key] || "(empty)"}</dd>
                  </div>
                ) : null,
              )}
            </dl>
          )}
        </div>
      )}
      {state.status === "failed" && (
        <div className="notice notice--error" role="alert">
          <strong>Your latest changes haven’t reached the server.</strong>
          <p>{state.error} Your text is still here — keep this tab open and retry.</p>
        </div>
      )}

      <div className="idea-layout">
        <section className="panel idea-form" aria-labelledby="idea-heading">
          <h2 id="idea-heading">What would you like to explain?</h2>
          <div className="field">
            <label htmlFor="topic">Topic</label>
            <textarea
              id="topic"
              rows={4}
              value={local.topic}
              placeholder="e.g. Explain binary search to a beginner"
              onChange={(e) => edit({ topic: e.target.value })}
              aria-describedby="topic-hint"
              aria-invalid={count(local.topic) > LIMITS.topic}
            />
            <p id="topic-hint" className="hint field-hint">
              <span>{topicMissing ? "Add a topic to create a storyboard." : "Describe the idea in plain words. English only for now."}</span>
              <span className={count(local.topic) > LIMITS.topic ? "over" : ""}>{count(local.topic).toLocaleString("en-IN")}/2,000</span>
            </p>
          </div>

          <button type="button" className="text-link details-toggle" aria-expanded={showDetails} aria-controls="idea-details" onClick={() => setShowDetails((v) => !v)}>
            {showDetails ? "Hide audience and notes" : "Add audience and notes (optional)"}
          </button>
          <div id="idea-details" hidden={!showDetails}>
            <div className="field">
              <label htmlFor="audience">Audience</label>
              <input id="audience" value={local.audience} placeholder="e.g. School students new to coding" onChange={(e) => edit({ audience: e.target.value })} aria-describedby="audience-hint" />
              <p id="audience-hint" className="hint field-hint"><span>Who is this for?</span><span className={count(local.audience) > LIMITS.audience ? "over" : ""}>{count(local.audience)}/200</span></p>
            </div>
            <div className="field">
              <label htmlFor="notes">Notes</label>
              <textarea id="notes" rows={6} value={local.notes} placeholder="Facts, examples or points the video must include" onChange={(e) => edit({ notes: e.target.value })} aria-describedby="notes-hint" />
              <p id="notes-hint" className="hint field-hint"><span>Reference material is treated as source facts, not instructions.</span><span className={count(local.notes) > LIMITS.notes ? "over" : ""}>{count(local.notes).toLocaleString("en-IN")}/20,000</span></p>
            </div>
          </div>

          <fieldset className="field voices">
            <legend>Narrator</legend>
            {voices.map((voice) => (
              <div key={voice.preset} className="voice-row">
                <label className="voice-option">
                  <input type="radio" name="voice" value={voice.preset} checked={local.voicePreset === voice.preset} onChange={() => edit({ voicePreset: voice.preset })} />
                  <span>
                    <strong>{voice.label}</strong>
                    <span className="muted"> · {voice.accent}{voice.testOnly ? " · test voice" : ""}</span>
                  </span>
                </label>
                {voice.sampleUrl && (
                  <audio className="voice-sample" controls preload="none" src={voice.sampleUrl} aria-label={`Preview ${voice.label}`} />
                )}
              </div>
            ))}
            {!voices.some((voice) => voice.preset === local.voicePreset) && (
              <p className="notice notice--error" role="alert">The saved narrator isn’t available. Choose another voice.</p>
            )}
            {voices.some((voice) => !voice.sampleUrl) && <p className="hint">A preview isn’t available for every voice yet.</p>}
          </fieldset>

          <p className="hint">Videos are 60–90 seconds, vertical (9:16). The length follows your script.</p>
          <div className="idea-next">
            <div className="actions">
              <button
                type="button"
                className="button button--primary"
                onClick={() => void create.start()}
                disabled={topicMissing || create.state === "creating" || create.state === "applying" || state.status === "conflict"}
                aria-busy={create.state === "creating" || create.state === "applying"}
              >
                {create.state === "creating" || create.state === "applying" ? "Creating storyboard…" : hasStoryboard ? "Create a new storyboard" : "Create storyboard →"}
              </button>
              {hasStoryboard && (
                <a className="button button--secondary" href={storyboardPath} onClick={async (event) => { event.preventDefault(); if (await controller.flush()) window.location.assign(storyboardPath); }}>
                  Review storyboard →
                </a>
              )}
            </div>
            <p className="hint">
              {topicMissing ? "Add a topic to create a storyboard." : hasStoryboard ? "A new storyboard replaces the one you’re editing; earlier versions stay in history." : "Gemini writes the scenes; you review every word before anything is generated."}
            </p>
          </div>
        </section>

        <Brainstorm
          projectId={project.id}
          controller={controller}
          initialIdeas={initialIdeas}
          activeJobId={activeJob?.type === "brainstorm" ? activeJob.id : null}
          enabled={ideasEnabled}
          onUse={(s) => {
            edit({ topic: s.topic, ...(local.notes.trim() ? {} : { notes: `Angle: ${s.angle}\nKey takeaway: ${s.takeaway}` }) });
          }}
        />
      </div>
    </div>
  );
}

function Brainstorm({
  projectId,
  controller,
  initialIdeas,
  activeJobId,
  enabled,
  onUse,
}: {
  projectId: string;
  controller: DraftAutosave;
  initialIdeas: Suggestion[];
  activeJobId: string | null;
  enabled: boolean;
  onUse: (suggestion: Suggestion) => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [ideas, setIdeas] = useState(initialIdeas);
  const [jobId, setJobId] = useState<string | null>(activeJobId);
  const [error, setError] = useState<string | null>(null);
  const [used, setUsed] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const keyRef = useRef<{ prompt: string; key: string } | null>(null);

  // Poll the job every 2 s while visible (10 s when hidden) until it finishes.
  useEffect(() => {
    if (!jobId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const { data } = await apiFetch<JobDto>(`/api/jobs/${jobId}`);
        if (stopped) return;
        if (data.state === "succeeded") {
          setIdeas(data.result?.suggestions ?? []);
          setJobId(null);
          return;
        }
        if (["failed", "cancelled", "needs_input"].includes(data.state)) {
          setError(data.error?.message ?? "Ideas couldn’t be generated. Try again.");
          setJobId(null);
          return;
        }
      } catch (caught) {
        if (stopped) return;
        if (caught instanceof ClientApiError && caught.status === 404) {
          setJobId(null);
          return;
        }
      }
      timer = setTimeout(poll, document.hidden ? 10_000 : 2_000);
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [jobId]);

  async function suggest() {
    if (!prompt.trim() || submitting || jobId) return;
    setSubmitting(true);
    setError(null);
    setUsed(null);
    try {
      // Requests snapshot the saved draft, so pending edits are flushed first.
      if (!(await controller.flush())) {
        setError("Save your draft before asking for ideas.");
        return;
      }
      if (!keyRef.current || keyRef.current.prompt !== prompt) keyRef.current = { prompt, key: crypto.randomUUID() };
      const { data } = await apiFetch<{ jobId: string }>(`/api/projects/${projectId}/brainstorm`, {
        method: "POST",
        body: { expectedDraftRevision: controller.snapshot.revision, prompt },
        idempotencyKey: keyRef.current.key,
      });
      keyRef.current = null;
      setJobId(data.jobId);
    } catch (caught) {
      if (caught instanceof ClientApiError && caught.code === "PROJECT_BUSY" && typeof caught.details?.activeJobId === "string") {
        setJobId(caught.details.activeJobId);
      } else {
        if (caught instanceof ClientApiError && caught.status < 500) keyRef.current = null;
        setError(caught instanceof ClientApiError ? caught.message : "Ideas couldn’t be requested. Try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  const busy = submitting || jobId !== null;
  return (
    <aside className="panel brainstorm" aria-labelledby="brainstorm-heading">
      <h2 id="brainstorm-heading">Need ideas?</h2>
      <p className="muted">Describe a subject or audience and get three to five topic ideas you can use.</p>
      {enabled ? (
        <>
          <div className="field">
            <label htmlFor="brainstorm-prompt">What are you thinking about?</label>
            <textarea id="brainstorm-prompt" rows={3} value={prompt} maxLength={2000} placeholder="e.g. Computer science basics for school students" onChange={(e) => setPrompt(e.target.value)} />
          </div>
          <button type="button" className="button button--secondary" onClick={suggest} disabled={busy || !prompt.trim()} aria-busy={busy}>
            {busy ? "Thinking of ideas…" : "Suggest topics"}
          </button>
          {busy && <p className="hint" role="status">You can keep editing while ideas are prepared.</p>}
        </>
      ) : (
        <p className="notice">Idea suggestions aren’t available right now.</p>
      )}
      {error && <div className="notice notice--error" role="alert">{error}</div>}
      {used && <p className="notice notice--success" role="status">Added “{used}” as your topic.</p>}
      {ideas.length > 0 && (
        <ul className="ideas">
          {ideas.map((idea) => (
            <li key={idea.id} className="idea-card">
              <strong>{idea.topic}</strong>
              <p>{idea.angle}</p>
              <p className="muted">Takeaway: {idea.takeaway}</p>
              <button
                type="button"
                className="button button--secondary button--small"
                onClick={() => {
                  onUse(idea);
                  setUsed(idea.topic);
                }}
              >
                Use idea
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
