"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch, ClientApiError } from "@/lib/api-client";

// Generating video (screens 10 / 12): honest stage list from the durable job, no fake overall percentage,
// cancel with confirmation, retry with explicit acknowledgement when a provider outcome is unknown.

type JobView = {
  id: string;
  state: "queued" | "running" | "cancel_requested" | "cancelled" | "succeeded" | "needs_input" | "failed";
  stage: string;
  revision: number;
  attempt: number;
  progress: { completedScenes: number | null; totalScenes: number | null; renderPercent: number | null };
  error: { code: string; message: string; retryable: boolean; correlationId: string } | null;
  actions: { cancel: boolean; retry: boolean };
  createdAt: string;
  updatedAt: string;
};

const ACTIVE = ["queued", "running", "cancel_requested"];

function stages(job: JobView) {
  const done = job.progress.completedScenes ?? 0;
  const total = job.progress.totalScenes ?? 0;
  const narrationDone = total > 0 && done >= total;
  const failedAt = job.state === "failed" && job.stage === "speech" ? "speech" : null;
  const status = (key: "prepare" | "speech" | "timing" | "render" | "check") => {
    if (key === "prepare") return job.state === "queued" ? "waiting" : "done";
    if (key === "speech") return narrationDone ? "done" : failedAt === "speech" ? "failed" : job.state === "running" || job.state === "cancel_requested" ? "active" : job.state === "queued" ? "waiting" : "stopped";
    const order = ["queued", "speech", "compile", "render", "finalize"];
    const at = order.indexOf(job.stage);
    const position = { timing: 2, render: 3, check: 4 }[key];
    if (job.state === "succeeded") return "done";
    if (job.state === "failed" && at === position) return "failed";
    if (at > position) return "done";
    if (at === position && ACTIVE.includes(job.state)) return "active";
    return "waiting";
  };
  return [
    { key: "prepare", label: "Preparing scenes", detail: job.state === "queued" ? "Waiting to start" : "Approved storyboard locked in", status: status("prepare") },
    { key: "speech", label: "Creating narration", detail: total ? `${done} of ${total} scenes recorded` : "", status: status("speech") },
    { key: "timing", label: "Timing visuals and captions", detail: "", status: status("timing") },
    { key: "render", label: "Rendering video", detail: job.stage === "render" && job.progress.renderPercent != null ? `${job.progress.renderPercent}% rendered` : "", status: status("render") },
    { key: "check", label: "Checking output", detail: "", status: status("check") },
  ];
}

export function VideoProgress({ projectId, initial }: { projectId: string; initial: JobView }) {
  const [job, setJob] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [ackNeeded, setAckNeeded] = useState(false);
  const [busy, setBusy] = useState(false);
  const cancelDialog = useRef<HTMLDialogElement>(null);
  const started = useRef(Date.now());

  useEffect(() => {
    if (!ACTIVE.includes(job.state)) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const { data } = await apiFetch<JobView>(`/api/jobs/${job.id}`);
        if (stopped) return;
        setJob(data);
        if (data.state === "succeeded") {
          window.location.reload(); // show the finished video
          return;
        }
        if (!ACTIVE.includes(data.state)) return;
      } catch {
        // keep polling; transient network errors are expected
      }
      timer = setTimeout(poll, document.hidden ? 10_000 : 2_000);
    };
    timer = setTimeout(poll, 2_000);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [job.id, job.state]);

  async function cancel() {
    setBusy(true);
    setError(null);
    try {
      const { data } = await apiFetch<JobView>(`/api/jobs/${job.id}/cancel`, { method: "POST", body: { expectedRevision: job.revision }, idempotencyKey: crypto.randomUUID() });
      setJob(data);
      cancelDialog.current?.close();
    } catch (caught) {
      setError(caught instanceof ClientApiError ? caught.message : "Couldn’t cancel. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function retry(acknowledge = false) {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/jobs/${job.id}/retry`, {
        method: "POST",
        body: { expectedRevision: job.revision, ...(acknowledge ? { acknowledgePossibleProviderRepeat: true } : {}) },
        idempotencyKey: crypto.randomUUID(),
      });
      const { data } = await apiFetch<JobView>(`/api/jobs/${job.id}`);
      setAckNeeded(false);
      started.current = Date.now();
      setJob(data);
    } catch (caught) {
      if (caught instanceof ClientApiError && caught.code === "REPEAT_ACK_REQUIRED") setAckNeeded(true);
      else setError(caught instanceof ClientApiError ? caught.message : "Couldn’t retry. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const waitingLong = job.state === "queued" && Date.now() - Date.parse(job.updatedAt) > 90_000;
  return (
    <section className="panel video-progress" aria-labelledby="progress-heading">
      <h2 id="progress-heading">
        {job.state === "failed" ? "Generation stopped" : job.state === "cancelled" ? "Generation cancelled" : job.state === "cancel_requested" ? "Cancelling…" : job.state === "succeeded" ? "Video ready" : "Generating your video"}
      </h2>
      {ACTIVE.includes(job.state) && <p className="muted">You can leave this page and come back; generation continues on the server.</p>}
      {waitingLong && <p className="notice">Waiting for the job runner to pick this up. If this persists, the background worker may not be running.</p>}

      <ol className="stage-list">
        {stages(job).map((stage) => (
          <li key={stage.key} className={`stage stage--${stage.status}`}>
            <span className="stage-icon" aria-hidden="true">{stage.status === "done" ? "✓" : stage.status === "failed" ? "!" : stage.status === "active" ? "•" : ""}</span>
            <div>
              <strong>{stage.label}</strong>
              {stage.detail && <span className="muted"> · {stage.detail}</span>}
              <span className="visually-hidden"> ({stage.status})</span>
            </div>
          </li>
        ))}
      </ol>

      {job.state === "failed" && job.error && (
        <div className="notice notice--error" role="alert">
          <strong>{job.error.message}</strong>
          <p className="hint">Reference: {job.error.correlationId}</p>
        </div>
      )}
      {job.state === "cancelled" && <p className="notice">Generation was cancelled. Your approved storyboard is unchanged.</p>}
      {ackNeeded && (
        <div className="notice notice--error" role="alert">
          <strong>A narration request may already have been charged.</strong>
          <p>Retrying may record that scene again and use more ElevenLabs characters.</p>
          <div className="actions">
            <button type="button" className="button button--primary button--small" onClick={() => retry(true)} disabled={busy}>Retry anyway</button>
            <button type="button" className="button button--secondary button--small" onClick={() => setAckNeeded(false)}>Not now</button>
          </div>
        </div>
      )}
      {error && <div className="notice notice--error" role="alert">{error}</div>}

      <div className="actions">
        {job.actions.retry && !ackNeeded && (
          <button type="button" className="button button--primary" onClick={() => retry()} disabled={busy}>{busy ? "Retrying…" : "Retry"}</button>
        )}
        {job.actions.cancel && (
          <button type="button" className="button button--secondary" onClick={() => cancelDialog.current?.showModal()}>Cancel generation</button>
        )}
        <a className="button button--secondary" href={`/projects/${projectId}/storyboard`}>Back to storyboard</a>
      </div>
      <p className="hint">Attempt {job.attempt} · started {new Date(job.createdAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</p>

      <dialog ref={cancelDialog} className="dialog" aria-labelledby="cancel-title">
        <h2 id="cancel-title">Cancel video generation?</h2>
        <p className="muted">Work that has already started, like a narration request in progress, may still finish. Your approved storyboard stays as it is.</p>
        <div className="dialog-actions">
          <button type="button" className="button button--secondary" onClick={() => cancelDialog.current?.close()}>Keep generating</button>
          <button type="button" className="button button--danger" onClick={cancel} disabled={busy}>{busy ? "Cancelling…" : "Cancel generation"}</button>
        </div>
      </dialog>
    </section>
  );
}
