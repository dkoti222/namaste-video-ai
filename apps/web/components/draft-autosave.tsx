"use client";

import { useEffect, useMemo, useState } from "react";
import { apiFetch, ClientApiError } from "@/lib/api-client";
import { DraftAutosave, SaveConflict, type AutosaveState, type DraftFields } from "@/lib/autosave";

// Shared draft autosave wiring for the idea and storyboard pages.

export type DraftDto = { revision: number; topic: string; audience: string; notes: string; voicePreset: string; editablePlan: unknown };
export const fieldsOf = (draft: DraftDto): DraftFields => ({
  topic: draft.topic,
  audience: draft.audience,
  notes: draft.notes,
  voicePreset: draft.voicePreset,
  editablePlan: draft.editablePlan,
});

export function useDraftAutosave(projectId: string, initial: DraftDto) {
  const [state, setState] = useState<AutosaveState | null>(null);
  const controller = useMemo(
    () =>
      new DraftAutosave({ revision: initial.revision, fields: fieldsOf(initial) }, async (expectedRevision, changes) => {
        try {
          const { data } = await apiFetch<DraftDto>(`/api/projects/${projectId}/draft`, { method: "PATCH", body: { expectedRevision, changes } });
          return { revision: data.revision, fields: fieldsOf(data) };
        } catch (error) {
          if (error instanceof ClientApiError && error.code === "REVISION_CONFLICT") throw new SaveConflict(Number(error.details?.currentRevision));
          throw error;
        }
      }),
    // The controller is created once per page; later server state arrives through reload/reapply.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projectId],
  );
  useEffect(() => {
    const unsubscribe = controller.subscribe(setState);
    setState(controller.snapshot);
    return () => {
      unsubscribe();
      controller.dispose();
    };
  }, [controller]);
  return { controller, state: state ?? controller.snapshot };
}

export function SaveIndicator({ state, onRetry }: { state: AutosaveState; onRetry: () => void }) {
  const time = state.lastSavedAt?.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
  const label: Record<AutosaveState["status"], string> = {
    saved: time ? `Saved · ${time}` : "Saved",
    unsaved: "Unsaved changes",
    saving: "Saving…",
    failed: "Save failed",
    conflict: "Not saved — changed in another tab",
  };
  return (
    <div className={`save-status save-status--${state.status}`} role="status" aria-live="polite">
      <span className="save-dot" aria-hidden="true" />
      {label[state.status]}
      {state.status === "failed" && (
        <button type="button" className="text-link save-retry" onClick={onRetry}>Retry</button>
      )}
    </div>
  );
}

