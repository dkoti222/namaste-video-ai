"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch, ClientApiError } from "@/lib/api-client";
import type { VideoView } from "@/server/videos/service";

// Captions and Revise tabs for a ready video (screens 11 / 21). Caption fixes change on-screen text only and create a
// new version with the same narration; anything that changes what is spoken goes back through the storyboard.

type CaptionLine = { id: string; sourceStart: number; sourceEnd: number; text: string; startFrame: number; endFrame: number };
type CaptionsView = { renderSpecHash: string; scenes: { sceneId: string; speechFingerprint: string; captions: CaptionLine[] }[] };
export type StoryboardInfo = { id: string; contentHash: string; scenes: { id: string; title: string }[] };
const time = (frame: number) => `${Math.floor(frame / 1800)}:${String(Math.floor((frame / 30) % 60)).padStart(2, "0")}`;

function Captions({ video, projectId }: { video: VideoView; projectId: string }) {
  const [data, setData] = useState<CaptionsView | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [flagged, setFlagged] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const keyRef = useRef<string | null>(null);

  useEffect(() => {
    setData(null);
    setEdits({});
    apiFetch<CaptionsView>(`/api/videos/${video.id}/captions`).then(({ data }) => setData(data)).catch((e) => setError(e instanceof ClientApiError ? e.message : "Captions couldn’t be loaded."));
  }, [video.id]);

  const changed = data ? data.scenes.flatMap((scene) => scene.captions.filter((c) => edits[c.id] !== undefined && edits[c.id] !== c.text).map((c) => ({ scene, c }))) : [];

  async function save() {
    if (!data || !changed.length) return;
    setBusy(true);
    setError(null);
    setFlagged(new Set());
    keyRef.current ??= crypto.randomUUID();
    const overrides = changed.map(({ scene, c }) => ({ sceneId: scene.sceneId, speechFingerprint: scene.speechFingerprint, sourceStart: c.sourceStart, sourceEnd: c.sourceEnd, displayText: edits[c.id] }));
    try {
      await apiFetch(`/api/videos/${video.id}/captions`, { method: "PATCH", body: { expectedRenderSpecHash: data.renderSpecHash, overrides }, idempotencyKey: keyRef.current });
      window.location.reload(); // the new version appears with its progress
    } catch (caught) {
      keyRef.current = null;
      if (caught instanceof ClientApiError) {
        const fieldErrors = (caught.details?.fieldErrors as { path: string }[] | undefined) ?? [];
        setFlagged(new Set(fieldErrors.map((f) => changed[Number(f.path.split(".")[1])]?.c.id).filter(Boolean) as string[]));
        setError(caught.message);
      } else setError("Caption changes couldn’t be saved.");
      setBusy(false);
    }
  }

  if (!data) return error ? <div className="notice notice--error" role="alert">{error}</div> : <p className="muted" aria-busy="true">Loading captions…</p>;
  return (
    <div className="captions-tab">
      <p className="hint">Fix spelling, punctuation or capitalisation in the on-screen captions. The narration stays exactly the same; you’ll get a new version to review. To change what is said, <a className="text-link" href={`/projects/${projectId}/storyboard`}>revise the storyboard</a>.</p>
      {error && <div className="notice notice--error" role="alert">{error}{flagged.size > 0 && <p><a className="text-link" href={`/projects/${projectId}/storyboard`}>Open the storyboard →</a></p>}</div>}
      <ol className="caption-list">
        {data.scenes.map((scene, sceneIndex) =>
          scene.captions.map((c, i) => (
            <li key={c.id} className={flagged.has(c.id) ? "caption-row caption-row--flagged" : "caption-row"}>
              <span className="caption-time">{i === 0 ? `Scene ${sceneIndex + 1} · ` : ""}{time(c.startFrame)}</span>
              <input
                aria-label={`Caption ${c.id}`}
                value={edits[c.id] ?? c.text}
                maxLength={54}
                onChange={(e) => setEdits((current) => ({ ...current, [c.id]: e.target.value }))}
              />
            </li>
          )),
        )}
      </ol>
      <div className="actions">
        <button type="button" className="button button--primary" onClick={save} disabled={busy || changed.length === 0}>
          {busy ? "Saving…" : changed.length ? `Save ${changed.length} caption change${changed.length === 1 ? "" : "s"}` : "No caption changes"}
        </button>
        {changed.length > 0 && <button type="button" className="button button--secondary" onClick={() => setEdits({})}>Undo changes</button>}
      </div>
    </div>
  );
}

function Revise({ projectId, storyboard }: { projectId: string; storyboard: StoryboardInfo | null }) {
  const [scope, setScope] = useState("all");
  const [instruction, setInstruction] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);
  const [result, setResult] = useState<{ id: string; contentHash: string; changeSummary: string | null; sourceDraftRevision: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!jobId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const { data } = await apiFetch<{ state: string; result: { storyboardId?: string } | null; error: { message: string } | null }>(`/api/jobs/${jobId}`);
        if (stopped) return;
        if (data.state === "succeeded" && data.result?.storyboardId) {
          const { data: sb } = await apiFetch<{ id: string; contentHash: string; changeSummary: string | null; sourceDraftRevision: number }>(`/api/storyboards/${data.result.storyboardId}`);
          setResult(sb);
          setJobId(null);
          return;
        }
        if (["failed", "cancelled", "needs_input"].includes(data.state)) {
          setError(data.error?.message ?? "The change couldn’t be made.");
          setJobId(null);
          return;
        }
      } catch {
        // keep polling
      }
      timer = setTimeout(poll, document.hidden ? 10_000 : 2_000);
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [jobId]);

  if (!storyboard) return <p className="notice">This video’s storyboard isn’t available.</p>;

  async function submit() {
    if (!instruction.trim() || busy || !storyboard) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const { data: draft } = await apiFetch<{ revision: number; sourceStoryboardId: string | null }>(`/api/projects/${projectId}/draft`);
      if (draft.sourceStoryboardId !== storyboard.id) {
        setError("Your storyboard has changed since this video was made. Make changes in the storyboard step instead.");
        return;
      }
      const { data } = await apiFetch<{ jobId: string }>(`/api/projects/${projectId}/revisions`, {
        method: "POST",
        body: { source: { kind: "storyboard", id: storyboard.id, hash: storyboard.contentHash }, expectedDraftRevision: draft.revision, instruction, ...(scope === "all" ? {} : { sceneId: scope }) },
        idempotencyKey: crypto.randomUUID(),
      });
      setJobId(data.jobId);
    } catch (caught) {
      setError(caught instanceof ClientApiError ? caught.message : "The change couldn’t be requested.");
    } finally {
      setBusy(false);
    }
  }

  async function review() {
    if (!result) return;
    try {
      const { data: draft } = await apiFetch<{ revision: number }>(`/api/projects/${projectId}/draft`);
      await apiFetch(`/api/projects/${projectId}/draft/apply`, { method: "POST", body: { expectedDraftRevision: draft.revision, storyboardId: result.id, expectedContentHash: result.contentHash }, idempotencyKey: crypto.randomUUID() });
      window.location.assign(`/projects/${projectId}/storyboard`);
    } catch (caught) {
      setError(caught instanceof ClientApiError ? caught.message : "The revision couldn’t be opened.");
    }
  }

  return (
    <div className="revise-tab">
      <p className="hint">Describe what to change. The result goes back to the storyboard for your approval before a new video is made, so the narration always matches.</p>
      <div className="field">
        <label htmlFor="video-revise-scope">Apply to</label>
        <select id="video-revise-scope" className="select" value={scope} onChange={(e) => setScope(e.target.value)}>
          <option value="all">Entire video</option>
          {storyboard.scenes.map((s, i) => <option key={s.id} value={s.id}>Scene {i + 1}: {s.title}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor="video-revise-text">Change</label>
        <textarea id="video-revise-text" rows={3} maxLength={4000} value={instruction} placeholder="e.g. Make scene 3 simpler with an everyday example" onChange={(e) => setInstruction(e.target.value)} />
      </div>
      <button type="button" className="button button--secondary" onClick={submit} disabled={busy || jobId !== null || !instruction.trim()}>{jobId ? "Revising…" : "Ask for changes"}</button>
      {error && <div className="notice notice--error" role="alert">{error}</div>}
      {result && (
        <div className="review-changes" role="region" aria-label="Proposed changes">
          <h3>Proposed changes</h3>
          <p>{result.changeSummary}</p>
          <div className="actions">
            <button type="button" className="button button--primary button--small" onClick={review}>Review in storyboard →</button>
            <button type="button" className="button button--secondary button--small" onClick={() => setResult(null)}>Discard</button>
          </div>
        </div>
      )}
    </div>
  );
}

export function VideoTabs({ video, projectId, storyboard }: { video: VideoView; projectId: string; storyboard: StoryboardInfo | null }) {
  const [tab, setTab] = useState<"captions" | "revise">("captions");
  return (
    <section className="panel video-tabs" aria-label="Captions and revisions">
      <div className="tab-list" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "captions"} className="tab" onClick={() => setTab("captions")}>Captions</button>
        <button type="button" role="tab" aria-selected={tab === "revise"} className="tab" onClick={() => setTab("revise")}>Revise</button>
      </div>
      <div role="tabpanel">{tab === "captions" ? <Captions video={video} projectId={projectId} /> : <Revise projectId={projectId} storyboard={storyboard} />}</div>
    </section>
  );
}
