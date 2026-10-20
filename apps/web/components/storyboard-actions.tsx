"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch, ClientApiError } from "@/lib/api-client";
import type { DraftAutosave } from "@/lib/autosave";
import type { PlanV2 } from "@/lib/plan";

// Storyboard conversation, change review, approval and version history (screens 08 / 09, FR-08).

export type StoryboardSummary = {
  id: string;
  parentId: string | null;
  sourceDraftRevision: number;
  state: "review_ready" | "approved";
  title: string;
  contentHash: string;
  changeSummary: string | null;
  changedSceneIds: string[];
  approvalId: string | null;
  createdAt: string;
};
type Candidate = StoryboardSummary & { content: PlanV2 };
type JobDto = { state: string; result: { storyboardId?: string } | null; error: { message: string } | null };

const time = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

/** Saves pending edits, then returns the saved draft's revision and content hash (exact approval precondition). */
async function savedDraft(projectId: string, controller: DraftAutosave) {
  if (!(await controller.flush())) throw new Error("Your latest edits haven’t been saved yet.");
  const { data } = await apiFetch<{ revision: number; contentHash: string }>(`/api/projects/${projectId}/draft`);
  return data;
}

export function RevisePanel({
  projectId,
  plan,
  controller,
  source,
  activeJob,
}: {
  projectId: string;
  plan: PlanV2;
  controller: DraftAutosave;
  source: { id: string; contentHash: string } | null;
  activeJob: { id: string; type: string } | null;
}) {
  const [instruction, setInstruction] = useState("");
  const [scope, setScope] = useState("all");
  const [jobId, setJobId] = useState<string | null>(activeJob?.type === "revision" ? activeJob.id : null);
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const keyRef = useRef<{ text: string; key: string } | null>(null);

  useEffect(() => {
    if (!jobId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const { data } = await apiFetch<JobDto>(`/api/jobs/${jobId}`);
        if (stopped) return;
        if (data.state === "succeeded" && data.result?.storyboardId) {
          const { data: storyboard } = await apiFetch<Candidate>(`/api/storyboards/${data.result.storyboardId}`);
          setCandidate(storyboard);
          setJobId(null);
          return;
        }
        if (["failed", "cancelled", "needs_input"].includes(data.state)) {
          setError(data.error?.message ?? "The change couldn’t be made. Try rephrasing it.");
          setJobId(null);
          return;
        }
      } catch (caught) {
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

  async function submit() {
    if (!instruction.trim() || !source || busy || jobId) return;
    setBusy(true);
    setError(null);
    setCandidate(null);
    try {
      const draft = await savedDraft(projectId, controller);
      const sceneId = scope === "all" ? undefined : scope;
      const text = `${scope}:${instruction}`;
      if (!keyRef.current || keyRef.current.text !== text) keyRef.current = { text, key: crypto.randomUUID() };
      const { data } = await apiFetch<{ jobId: string }>(`/api/projects/${projectId}/revisions`, {
        method: "POST",
        body: { source: { kind: "storyboard", id: source.id, hash: source.contentHash }, expectedDraftRevision: draft.revision, instruction, ...(sceneId ? { sceneId } : {}) },
        idempotencyKey: keyRef.current.key,
      });
      keyRef.current = null;
      setJobId(data.jobId);
    } catch (caught) {
      if (caught instanceof ClientApiError && caught.code === "PROJECT_BUSY" && typeof caught.details?.activeJobId === "string") setJobId(caught.details.activeJobId);
      else {
        if (caught instanceof ClientApiError && caught.status < 500) keyRef.current = null;
        setError(caught instanceof Error ? caught.message : "The change couldn’t be requested.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function keep(confirmedOlder: boolean) {
    if (!candidate) return;
    const draft = await savedDraft(projectId, controller).catch((e: Error) => { setError(e.message); return null; });
    if (!draft) return;
    // Stale-result handling: a revision based on an older draft never silently replaces newer edits.
    if (candidate.sourceDraftRevision < draft.revision && !confirmedOlder) {
      setError("stale");
      return;
    }
    try {
      await apiFetch(`/api/projects/${projectId}/draft/apply`, {
        method: "POST",
        body: { expectedDraftRevision: draft.revision, storyboardId: candidate.id, expectedContentHash: candidate.contentHash },
        idempotencyKey: crypto.randomUUID(),
      });
      window.location.reload();
    } catch (caught) {
      setError(caught instanceof ClientApiError ? caught.message : "The revision couldn’t be applied.");
    }
  }

  const changed = candidate ? candidate.content.scenes.filter((s) => candidate.changedSceneIds.includes(s.id)) : [];
  const before = new Map(plan.scenes.map((s) => [s.id, s]));
  const running = busy || jobId !== null;

  return (
    <section className="panel revise" aria-labelledby="revise-heading">
      <h2 id="revise-heading">Revise with AI</h2>
      <p className="muted">Describe a change in plain words. You’ll see what changed before anything replaces your storyboard.</p>
      <div className="field">
        <label htmlFor="revise-scope">Apply to</label>
        <select id="revise-scope" value={scope} onChange={(e) => setScope(e.target.value)}>
          <option value="all">Entire video</option>
          {plan.scenes.map((s, i) => <option key={s.id} value={s.id}>Scene {i + 1}: {s.title}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor="revise-text">Change</label>
        <textarea id="revise-text" rows={3} maxLength={4000} value={instruction} placeholder="e.g. Make the opening simpler" onChange={(e) => setInstruction(e.target.value)} />
      </div>
      <button type="button" className="button button--secondary" onClick={submit} disabled={running || !instruction.trim() || !source} aria-busy={running}>
        {running ? "Revising…" : "Ask for changes"}
      </button>
      {!source && <p className="hint">Revisions work on generated storyboards. Create a new storyboard to revise this one.</p>}
      {running && <p className="hint" role="status">Working on your change. You can keep reading meanwhile.</p>}
      {error && error !== "stale" && <div className="notice notice--error" role="alert">{error}</div>}

      {candidate && (
        <div className="review-changes" role="region" aria-label="Proposed changes">
          <h3>Proposed changes</h3>
          <p>{candidate.changeSummary}</p>
          {changed.length === 0 ? (
            <p className="muted">No scenes needed changes.</p>
          ) : (
            changed.map((scene) => {
              const old = before.get(scene.id);
              return (
                <div key={scene.id} className="change">
                  <strong>{old ? `Scene ${plan.scenes.indexOf(old) + 1}: ${scene.title}` : `New scene: ${scene.title}`}</strong>
                  {old && old.narration !== scene.narration && <p className="change-before"><span>Before</span>{old.narration}</p>}
                  <p className="change-after"><span>After</span>{scene.narration}</p>
                </div>
              );
            })
          )}
          {candidate.changedSceneIds.filter((id) => !candidate.content.scenes.some((s) => s.id === id)).map((id) => (
            <p key={id} className="change-removed">Removed scene: {before.get(id)?.title ?? id}</p>
          ))}
          {error === "stale" ? (
            <div className="notice notice--error" role="alert">
              <strong>This revision was based on an earlier version of your storyboard.</strong>
              <p>Keeping it would replace the edits you made since then.</p>
              <div className="actions">
                <button type="button" className="button button--primary button--small" onClick={() => keep(true)}>Keep revision anyway</button>
                <button type="button" className="button button--secondary button--small" onClick={() => { setCandidate(null); setError(null); }}>Discard</button>
              </div>
            </div>
          ) : (
            <div className="actions">
              <button type="button" className="button button--primary button--small" onClick={() => keep(false)}>Keep revision</button>
              <button type="button" className="button button--secondary button--small" onClick={() => setCandidate(null)}>Discard</button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export function ApprovePanel({
  projectId,
  controller,
  ready,
  blockedReason,
  approved,
  hasVideo = false,
}: {
  projectId: string;
  controller: DraftAutosave;
  ready: boolean;
  blockedReason: string | null;
  approved: { at: string; matches: boolean } | null;
  hasVideo?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const draft = await savedDraft(projectId, controller);
      await apiFetch(`/api/projects/${projectId}/generations`, {
        method: "POST",
        body: { expectedDraftRevision: draft.revision, expectedContentHash: draft.contentHash, approve: true },
        idempotencyKey: crypto.randomUUID(),
      });
      window.location.assign(`/projects/${projectId}/video`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The storyboard couldn’t be approved.");
      setBusy(false);
    }
  }

  const current = approved?.matches;
  return (
    <div className="sb-actions panel">
      <div>
        {current ? (
          <>
            <p className="approved-badge" role="status">✓ Approved · {time(approved!.at)}</p>
            <div className="actions">
              {hasVideo && <a className="button button--secondary" href={`/projects/${projectId}/video`}>View video progress →</a>}
              <button type="button" className="button button--primary" disabled={!ready} onClick={() => dialog.current?.showModal()}>
                {hasVideo ? "Generate again" : "Generate video"}
              </button>
            </div>
            <p className="hint">This exact storyboard is locked in.</p>
          </>
        ) : (
          <>
            <button type="button" className="button button--primary" disabled={!ready} onClick={() => dialog.current?.showModal()}>
              {approved ? "Approve changes & generate video" : "Approve & generate video"}
            </button>
            <p className="hint">
              {approved ? "You changed the storyboard after approving it. Approving again locks in these edits and generates a new video." : blockedReason ?? "Approving locks in this exact storyboard and starts generating the video."}
            </p>
          </>
        )}
      </div>
      <dialog ref={dialog} className="dialog" aria-labelledby="approve-title">
        <h2 id="approve-title">Approve and generate the video?</h2>
        <p className="muted">Read every scene first. The app checks structure and timing, not whether the facts are correct.</p>
        <p className="muted">The approved version can’t change. Narration is recorded with ElevenLabs (about one character per character of narration). You can follow progress and cancel.</p>
        {error && <div className="notice notice--error" role="alert">{error}</div>}
        <div className="dialog-actions">
          <button type="button" className="button button--secondary" onClick={() => dialog.current?.close()}>Cancel</button>
          <button type="button" className="button button--primary" onClick={confirm} disabled={busy}>{busy ? "Starting…" : "Approve & generate"}</button>
        </div>
      </dialog>
    </div>
  );
}

export function HistoryPanel({ projectId, versions, currentId, controller }: { projectId: string; versions: StoryboardSummary[]; currentId: string | null; controller: DraftAutosave }) {
  const [error, setError] = useState<string | null>(null);
  if (versions.length < 2) return null;
  async function restore(version: StoryboardSummary) {
    setError(null);
    try {
      const draft = await savedDraft(projectId, controller);
      await apiFetch(`/api/projects/${projectId}/draft/restore`, {
        method: "POST",
        body: { expectedDraftRevision: draft.revision, storyboardId: version.id, expectedContentHash: version.contentHash },
        idempotencyKey: crypto.randomUUID(),
      });
      window.location.reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That version couldn’t be restored.");
    }
  }
  return (
    <section className="panel history" aria-labelledby="history-heading">
      <h2 id="history-heading">Versions</h2>
      {error && <div className="notice notice--error" role="alert">{error}</div>}
      <ol className="history-list">
        {versions.map((version, index) => (
          <li key={version.id}>
            <div>
              <strong>Version {versions.length - index}</strong>
              {version.id === currentId && <span className="chip">Current</span>}
              {version.approvalId && <span className="chip chip--done">Approved</span>}
              <p className="muted">{version.changeSummary ?? (version.parentId ? "Revised" : "Generated from your idea")} · {time(version.createdAt)}</p>
            </div>
            {version.id !== currentId && (
              <button type="button" className="button button--secondary button--small" onClick={() => restore(version)}>Restore</button>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
