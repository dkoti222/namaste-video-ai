// Draft autosave controller (SYSTEM_DESIGN.md section 3.3, PRD FR-14). Framework-free so it can be unit-tested:
// one-second debounce, one save in flight, local text is never discarded on failure or conflict, and a conflict
// stops autosave until the user explicitly reloads or reapplies their edits.

export type DraftFields = { topic: string; audience: string; notes: string; voicePreset: string; editablePlan?: unknown };
export type SaveStatus = "saved" | "unsaved" | "saving" | "failed" | "conflict";

export type AutosaveState = {
  status: SaveStatus;
  local: DraftFields;
  saved: DraftFields;
  revision: number;
  error: string | null;
  conflictRevision: number | null;
  lastSavedAt: Date | null;
};

export class SaveConflict extends Error {
  constructor(readonly currentRevision: number) {
    super("This draft changed in another tab.");
  }
}

export type SaveFn = (expectedRevision: number, changes: Partial<DraftFields>) => Promise<{ revision: number; fields: DraftFields }>;

const KEYS: (keyof DraftFields)[] = ["topic", "audience", "notes", "voicePreset", "editablePlan"];

// The working storyboard is compared by content, not reference. Key order is stable because edits copy objects.
const same = (a: unknown, b: unknown) => a === b || (typeof a === "object" && typeof b === "object" && JSON.stringify(a) === JSON.stringify(b));

export function changedFields(local: DraftFields, saved: DraftFields): Partial<DraftFields> {
  const changes: Partial<DraftFields> = {};
  for (const key of KEYS) {
    if (local[key] === undefined && saved[key] === undefined) continue;
    if (!same(local[key], saved[key])) (changes as Record<string, unknown>)[key] = local[key];
  }
  return changes;
}

export class DraftAutosave {
  private state: AutosaveState;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inflight: Promise<void> | null = null;
  private readonly listeners = new Set<(state: AutosaveState) => void>();

  constructor(
    initial: { revision: number; fields: DraftFields },
    private readonly save: SaveFn,
    onChange?: (state: AutosaveState) => void,
    private readonly delayMs = 1000,
  ) {
    if (onChange) this.listeners.add(onChange);
    this.state = {
      status: "saved",
      local: { ...initial.fields },
      saved: { ...initial.fields },
      revision: initial.revision,
      error: null,
      conflictRevision: null,
      lastSavedAt: null,
    };
  }

  get snapshot(): AutosaveState {
    return this.state;
  }

  /** Registers a state listener; returns an unsubscribe function. */
  subscribe(listener: (state: AutosaveState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private set(patch: Partial<AutosaveState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener(this.state);
  }

  private dirty() {
    return Object.keys(changedFields(this.state.local, this.state.saved)).length > 0;
  }

  /** Records a local edit and schedules a save after the debounce. */
  edit(changes: Partial<DraftFields>) {
    const local = { ...this.state.local, ...changes };
    if (this.state.status === "conflict") {
      this.set({ local }); // keep typing safely; nothing is sent until the conflict is resolved
      return;
    }
    this.set({ local, status: this.inflight ? "saving" : "unsaved" });
    this.schedule();
  }

  private schedule() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.delayMs);
  }

  /**
   * Saves pending edits now and resolves true only when everything typed so far reached the server.
   * Call before generating, approving, navigating between steps or scheduling.
   */
  async flush(): Promise<boolean> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    while (true) {
      if (this.inflight) {
        await this.inflight;
        continue;
      }
      if (this.state.status === "conflict") return false;
      if (!this.dirty()) {
        if (this.state.status !== "saved") this.set({ status: "saved", error: null });
        return true;
      }
      const ok = await this.saveOnce();
      if (!ok) return false;
    }
  }

  private async saveOnce(): Promise<boolean> {
    const changes = changedFields(this.state.local, this.state.saved);
    const expectedRevision = this.state.revision;
    this.set({ status: "saving", error: null });
    let succeeded = false;
    this.inflight = (async () => {
      try {
        const result = await this.save(expectedRevision, changes);
        succeeded = true;
        // Edits typed while this request was in flight remain local and are saved next.
        const saved = result.fields;
        const stillDirty = Object.keys(changedFields(this.state.local, saved)).length > 0;
        this.set({ saved, revision: result.revision, status: stillDirty ? "unsaved" : "saved", lastSavedAt: new Date() });
      } catch (error) {
        if (error instanceof SaveConflict) {
          this.set({ status: "conflict", conflictRevision: error.currentRevision, error: error.message });
        } else {
          this.set({ status: "failed", error: error instanceof Error ? error.message : "Save failed." });
        }
      }
    })();
    try {
      await this.inflight;
    } finally {
      this.inflight = null;
    }
    return succeeded;
  }

  /** Conflict resolution: discard local edits and adopt the newer server draft. */
  reload(server: { revision: number; fields: DraftFields }) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.set({ local: { ...server.fields }, saved: { ...server.fields }, revision: server.revision, status: "saved", error: null, conflictRevision: null });
  }

  /** Conflict resolution: keep local edits and save them on top of the newer server draft (explicit user choice). */
  async reapply(server: { revision: number; fields: DraftFields }): Promise<boolean> {
    this.set({ saved: { ...server.fields }, revision: server.revision, status: "unsaved", error: null, conflictRevision: null });
    return this.flush();
  }

  dispose() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
