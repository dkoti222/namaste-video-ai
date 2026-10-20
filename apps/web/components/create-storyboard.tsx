"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch, ClientApiError } from "@/lib/api-client";
import type { DraftAutosave } from "@/lib/autosave";

// Create-storyboard flow shared by the idea and storyboard pages: flush saves → S03 job → poll → S06 apply.
// The candidate is applied against the revision the user is looking at; if the draft changed meanwhile, the user
// decides explicitly instead of the result silently replacing newer edits.

type JobDto = { state: string; result: { kind: string; storyboardId?: string } | null; error: { message: string } | null };
export type CreateState = "idle" | "creating" | "applying" | "conflict" | "error";

export function useCreateStoryboard(
  projectId: string,
  controller: DraftAutosave,
  activeJob: { id: string; type: string } | null,
  onApplied: () => void,
) {
  const [state, setState] = useState<CreateState>(activeJob?.type === "storyboard" ? "creating" : "idle");
  const [jobId, setJobId] = useState<string | null>(activeJob?.type === "storyboard" ? activeJob.id : null);
  const [error, setError] = useState<string | null>(null);
  const [candidate, setCandidate] = useState<{ id: string; contentHash: string } | null>(null);
  const keyRef = useRef<string | null>(null);

  async function apply(storyboard: { id: string; contentHash: string }, revision: number) {
    setState("applying");
    try {
      await apiFetch(`/api/projects/${projectId}/draft/apply`, {
        method: "POST",
        body: { expectedDraftRevision: revision, storyboardId: storyboard.id, expectedContentHash: storyboard.contentHash },
        idempotencyKey: crypto.randomUUID(),
      });
      onApplied();
    } catch (caught) {
      if (caught instanceof ClientApiError && caught.code === "REVISION_CONFLICT") {
        setCandidate(storyboard);
        setState("conflict");
      } else {
        setError(caught instanceof ClientApiError ? caught.message : "The storyboard couldn’t be opened. Try again.");
        setState("error");
      }
    }
  }

  useEffect(() => {
    if (!jobId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const { data } = await apiFetch<JobDto>(`/api/jobs/${jobId}`);
        if (stopped) return;
        if (data.state === "succeeded" && data.result?.storyboardId) {
          setJobId(null);
          const { data: storyboard } = await apiFetch<{ id: string; contentHash: string }>(`/api/storyboards/${data.result.storyboardId}`);
          await controller.flush();
          await apply(storyboard, controller.snapshot.revision);
          return;
        }
        if (["failed", "cancelled", "needs_input"].includes(data.state)) {
          setJobId(null);
          setError(data.error?.message ?? "The storyboard couldn’t be created. Try again.");
          setState("error");
          return;
        }
      } catch (caught) {
        if (stopped) return;
        if (caught instanceof ClientApiError && caught.status === 404) {
          setJobId(null);
          setState("idle");
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  async function start() {
    if (state === "creating" || state === "applying") return;
    setError(null);
    // The job snapshots the saved draft, so every edit must reach the server first.
    if (!(await controller.flush())) {
      setError("Your latest changes haven’t been saved yet. Resolve that before creating a storyboard.");
      setState("error");
      return;
    }
    setState("creating");
    keyRef.current ??= crypto.randomUUID();
    try {
      const { data } = await apiFetch<{ jobId: string }>(`/api/projects/${projectId}/storyboards`, {
        method: "POST",
        body: { expectedDraftRevision: controller.snapshot.revision },
        idempotencyKey: keyRef.current,
      });
      keyRef.current = null;
      setJobId(data.jobId);
    } catch (caught) {
      if (caught instanceof ClientApiError && caught.code === "PROJECT_BUSY" && typeof caught.details?.activeJobId === "string") {
        setJobId(caught.details.activeJobId);
        return;
      }
      if (caught instanceof ClientApiError && caught.status < 500) keyRef.current = null;
      setError(caught instanceof ClientApiError ? caught.message : "The storyboard couldn’t be requested. Try again.");
      setState("error");
    }
  }

  /** After a conflict: apply the candidate on top of the latest saved draft (explicit user choice). */
  async function applyAnyway() {
    if (!candidate) return;
    const { data } = await apiFetch<{ revision: number }>(`/api/projects/${projectId}/draft`);
    await apply(candidate, data.revision);
  }

  return { state, error, start, applyAnyway, dismiss: () => { setState("idle"); setError(null); } };
}

export function CreateStoryboardStatus({ flow }: { flow: ReturnType<typeof useCreateStoryboard> }) {
  if (flow.state === "creating" || flow.state === "applying") {
    return (
      <div className="notice job-progress" role="status">
        <strong>{flow.state === "creating" ? "Creating your storyboard…" : "Opening your storyboard…"}</strong>
        <p>Writing scenes and checking every visual. This usually takes under a minute. You can leave and come back.</p>
      </div>
    );
  }
  if (flow.state === "conflict") {
    return (
      <div className="notice notice--error" role="alert">
        <strong>Your idea changed while this storyboard was being made.</strong>
        <p>It was based on an earlier version. Use it anyway, or create a new one from your latest idea.</p>
        <div className="actions">
          <button type="button" className="button button--primary button--small" onClick={flow.applyAnyway}>Use this storyboard</button>
          <button type="button" className="button button--secondary button--small" onClick={flow.dismiss}>Keep editing</button>
        </div>
      </div>
    );
  }
  if (flow.state === "error" && flow.error) {
    return (
      <div className="notice notice--error" role="alert">
        <strong>Storyboard not created.</strong>
        <p>{flow.error}</p>
      </div>
    );
  }
  return null;
}
