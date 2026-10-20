"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { apiFetch, ClientApiError } from "@/lib/api-client";
import type { ProjectView } from "@/server/projects/service";

// My videos (screens 04, 05, 18): real project data, filters, load more, empty/loading/error states,
// rename and delete dialogs. Only actions that exist today are offered.

type Filter = "all" | "drafts" | "ready" | "scheduled" | "published" | "needs_attention";
const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "drafts", label: "Drafts" },
  { id: "ready", label: "Ready" },
  { id: "scheduled", label: "Scheduled" },
  { id: "published", label: "Published" },
  { id: "needs_attention", label: "Needs attention" },
];
const SAMPLE_TOPICS = ["Explain binary search visually in 4 steps", "How DNS resolution works", "Photosynthesis light reactions simplified"];
const PAGE_SIZE = 12;
const FLAG_FOR_FILTER: Record<Exclude<Filter, "all">, keyof ProjectView["flags"]> = {
  drafts: "drafts",
  ready: "ready",
  scheduled: "scheduled",
  published: "published",
  needs_attention: "needsAttention",
};

type Page = { items: ProjectView[]; nextCursor: string | null; hasMore: boolean };
type Status = "ready" | "loading" | "error";

const codePoints = (text: string) => [...text.trim()].length;
const newKey = () => crypto.randomUUID();

function statusChips(flags: ProjectView["flags"]) {
  const chips: { label: string; tone: string }[] = [];
  if (flags.needsAttention) chips.push({ label: "Needs attention", tone: "warning" });
  if (flags.published) chips.push({ label: "Published", tone: "done" });
  if (flags.scheduled) chips.push({ label: "Scheduled", tone: "info" });
  if (flags.ready) chips.push({ label: "Ready", tone: "done" });
  if (flags.drafts) chips.push({ label: "Draft", tone: "neutral" });
  return chips;
}

function previewLabel(project: ProjectView) {
  if (project.latestReadyVideoId) return "Video preview";
  if (project.currentStoryboardId) return "Storyboard preview · estimated";
  return "Idea in progress";
}

function matchesFilter(project: ProjectView, filter: Filter) {
  return filter === "all" || project.flags[FLAG_FOR_FILTER[filter]];
}

const byRecent = (a: ProjectView, b: ProjectView) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id);

export function Library({ initial, timeZone }: { initial: Page; timeZone: string }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [items, setItems] = useState(initial.items);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [hasMore, setHasMore] = useState(initial.hasMore);
  const [status, setStatus] = useState<Status>("ready");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<ProjectView | null>(null);
  const [deleting, setDeleting] = useState<ProjectView | null>(null);
  const createKey = useRef<{ title: string | undefined; key: string } | null>(null);
  const requestSeq = useRef(0);

  const formatter = new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
    timeZoneName: "short",
  });

  async function load(nextFilter: Filter) {
    const seq = ++requestSeq.current;
    setStatus("loading");
    setLoadError(null);
    setMoreError(null);
    try {
      const { data, page } = await apiFetch<ProjectView[]>(`/api/projects?limit=${PAGE_SIZE}&filter=${nextFilter}`);
      if (seq !== requestSeq.current) return;
      setItems(data);
      setCursor(page?.nextCursor ?? null);
      setHasMore(page?.hasMore ?? false);
      setStatus("ready");
    } catch (error) {
      if (seq !== requestSeq.current) return;
      setLoadError(error instanceof ClientApiError ? error.message : "Your videos couldn’t be loaded.");
      setStatus("error");
    }
  }

  function changeFilter(next: Filter) {
    if (next === filter && status !== "error") return;
    setFilter(next);
    void load(next);
  }

  async function loadMore() {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const { data, page } = await apiFetch<ProjectView[]>(
        `/api/projects?limit=${PAGE_SIZE}&filter=${filter}&cursor=${encodeURIComponent(cursor)}`,
      );
      // Lists are live: deduplicate by ID when items moved between pages.
      setItems((current) => [...current, ...data.filter((p) => !current.some((c) => c.id === p.id))]);
      setCursor(page?.nextCursor ?? null);
      setHasMore(page?.hasMore ?? false);
    } catch (error) {
      if (error instanceof ClientApiError && error.code === "INVALID_CURSOR") {
        void load(filter); // list position expired; start again from the first page
      } else {
        setMoreError(error instanceof ClientApiError ? error.message : "More videos couldn’t be loaded.");
      }
    } finally {
      setLoadingMore(false);
    }
  }

  async function create(title?: string) {
    if (creating) return;
    setCreating(true);
    setCreateError(null);
    // Reuse the same key if the previous identical attempt failed ambiguously (e.g. network loss).
    if (!createKey.current || createKey.current.title !== title) createKey.current = { title, key: newKey() };
    try {
      const { data } = await apiFetch<ProjectView>("/api/projects", {
        method: "POST",
        body: title ? { title } : {},
        idempotencyKey: createKey.current.key,
      });
      createKey.current = null;
      if (matchesFilter(data, filter)) setItems((current) => [data, ...current.filter((p) => p.id !== data.id)]);
      else {
        setFilter("all");
        void load("all");
      }
      setNotice(`“${data.title}” was created.`);
      window.location.assign(`/projects/${data.id}`);
    } catch (error) {
      if (error instanceof ClientApiError && error.status >= 400 && error.status < 500) createKey.current = null;
      setCreateError(error instanceof ClientApiError ? error.message : "The video couldn’t be created. Try again.");
    } finally {
      setCreating(false);
    }
  }

  function replaceProject(updated: ProjectView) {
    setItems((current) => current.map((p) => (p.id === updated.id ? updated : p)).sort(byRecent));
  }
  function removeProject(id: string) {
    setItems((current) => current.filter((p) => p.id !== id));
  }

  const empty = status === "ready" && items.length === 0;

  return (
    <section className="library" aria-labelledby="library-title">
      <div className="library-header">
        <div>
          <p className="eyebrow">Personal workspace</p>
          <h1 id="library-title">My videos</h1>
        </div>
        <button type="button" className="button button--primary" onClick={() => create()} disabled={creating} aria-busy={creating}>
          {creating ? "Creating…" : "+ Create a video"}
        </button>
      </div>
      {createError && <div className="notice notice--error" role="alert">{createError}</div>}
      {notice && (
        <div className="notice notice--success" role="status">
          {notice}
          <button type="button" className="notice-dismiss" onClick={() => setNotice(null)} aria-label="Dismiss message">×</button>
        </div>
      )}

      <div className="filters" role="group" aria-label="Filter videos">
        {FILTERS.map((option) => (
          <button
            key={option.id}
            type="button"
            className="filter-chip"
            aria-pressed={filter === option.id}
            onClick={() => changeFilter(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>

      {status === "loading" && (
        <div className="project-grid" aria-busy="true" aria-label="Loading videos">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="project-card project-card--skeleton" aria-hidden="true">
              <div className="thumb skeleton" />
              <div className="skeleton skeleton-line" />
              <div className="skeleton skeleton-line skeleton-line--short" />
            </div>
          ))}
        </div>
      )}

      {status === "error" && (
        <div className="state-panel" role="alert">
          <h2>Your videos couldn’t be loaded</h2>
          <p className="muted">{loadError} Your saved work is safe on the server.</p>
          <button type="button" className="button button--secondary" onClick={() => load(filter)}>Retry</button>
        </div>
      )}

      {empty && filter === "all" && (
        <div className="state-panel state-panel--hero">
          <div className="empty-diagram" aria-hidden="true"><span /><i /><span /><i /><span /></div>
          <h2>Your first video starts with an idea</h2>
          <p className="muted">Create a project, then describe what you want to explain. Or start from one of these topics:</p>
          <div className="sample-topics">
            {SAMPLE_TOPICS.map((topic) => (
              <button key={topic} type="button" className="sample-topic" onClick={() => create(topic)} disabled={creating}>
                {topic}
              </button>
            ))}
          </div>
        </div>
      )}

      {empty && filter !== "all" && (
        <div className="state-panel">
          <h2>No videos match this filter</h2>
          <p className="muted">Try another filter, or show all of your videos.</p>
          <button type="button" className="button button--secondary" onClick={() => changeFilter("all")}>Clear filters</button>
        </div>
      )}

      {status === "ready" && items.length > 0 && (
        <>
          <ul className="project-grid" aria-label="Your videos">
            {items.map((project) => (
              <li key={project.id} className="project-card">
                <div className="thumb" aria-hidden="true">
                  <div className="thumb-diagram"><span /><i /><span /><i /><span /></div>
                </div>
                <p className="thumb-label">{previewLabel(project)}</p>
                <div className="project-row">
                  <h2 className="project-title" title={project.title}><Link href={`/projects/${project.id}`} className="project-link">{project.title}</Link></h2>
                  <ProjectMenu project={project} onRename={() => setRenaming(project)} onDelete={() => setDeleting(project)} />
                </div>
                <div className="chips">
                  {statusChips(project.flags).map((chip) => (
                    <span key={chip.label} className={`chip chip--${chip.tone}`}>{chip.label}</span>
                  ))}
                </div>
                <p className="project-meta">
                  Updated <time dateTime={project.updatedAt} suppressHydrationWarning>{formatter.format(new Date(project.updatedAt))}</time>
                </p>
              </li>
            ))}
          </ul>
          {moreError && <div className="notice notice--error" role="alert">{moreError}</div>}
          {hasMore && (
            <div className="load-more">
              <button type="button" className="button button--secondary" onClick={loadMore} disabled={loadingMore} aria-busy={loadingMore}>
                {loadingMore ? "Loading…" : "Load more videos"}
              </button>
            </div>
          )}
        </>
      )}

      <RenameDialog
        project={renaming}
        onClose={() => setRenaming(null)}
        onRenamed={(updated) => {
          replaceProject(updated);
          setRenaming(null);
        }}
        onStale={() => load(filter)}
        onGone={removeProject}
      />
      <DeleteDialog
        project={deleting}
        onClose={() => setDeleting(null)}
        onDeleted={(id) => {
          removeProject(id);
          setDeleting(null);
          setNotice("The video was deleted.");
        }}
        onStale={() => load(filter)}
        onGone={removeProject}
      />
    </section>
  );
}

function ProjectMenu({ project, onRename, onDelete }: { project: ProjectView; onRename: () => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !container.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  const choose = (action: () => void) => () => {
    setOpen(false);
    action();
  };
  return (
    <div className="menu" ref={container}>
      <button type="button" className="menu-button" aria-haspopup="true" aria-expanded={open} aria-label={`Actions for ${project.title}`} onClick={() => setOpen((v) => !v)}>
        ⋯
      </button>
      {open && (
        <div className="menu-list">
          <Link href={`/projects/${project.id}`} className="menu-item">Open</Link>
          <button type="button" onClick={choose(onRename)}>Rename</button>
          <button type="button" className="menu-danger" onClick={choose(onDelete)}>Delete</button>
        </div>
      )}
    </div>
  );
}

function useModal(open: boolean) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return ref;
}

type DialogProps = { project: ProjectView | null; onClose: () => void; onStale: () => void; onGone: (id: string) => void };

function conflictMessage(error: unknown, project: ProjectView, onStale: () => void, onGone: (id: string) => void): string {
  if (error instanceof ClientApiError) {
    if (error.code === "REVISION_CONFLICT") {
      onStale();
      return "This video changed in another tab. The list was refreshed; please try again.";
    }
    if (error.status === 404) {
      onGone(project.id);
      return "This video is no longer available.";
    }
    return error.message;
  }
  return "Something went wrong. Try again.";
}

function RenameDialog({ project, onClose, onRenamed, onStale, onGone }: DialogProps & { onRenamed: (project: ProjectView) => void }) {
  const ref = useModal(project !== null);
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (project) {
      setTitle(project.title);
      setError(null);
    }
  }, [project]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!project || saving) return;
    const length = codePoints(title);
    if (length < 1 || length > 100) {
      setError("Use 1 to 100 characters.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const { data } = await apiFetch<ProjectView>(`/api/projects/${project.id}`, {
        method: "PATCH",
        body: { expectedRevision: project.revision, title: title.trim() },
      });
      onRenamed(data);
    } catch (caught) {
      setError(conflictMessage(caught, project, onStale, onGone));
    } finally {
      setSaving(false);
    }
  }

  return (
    <dialog ref={ref} className="dialog" onClose={onClose} aria-labelledby="rename-title">
      <form onSubmit={submit}>
        <h2 id="rename-title">Rename video</h2>
        <div className="field">
          <label htmlFor="rename-input">Title</label>
          <input id="rename-input" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} aria-describedby="rename-hint" autoFocus />
          <p id="rename-hint" className="hint">{codePoints(title)}/100 characters</p>
        </div>
        {error && <div className="notice notice--error" role="alert">{error}</div>}
        <div className="dialog-actions">
          <button type="button" className="button button--secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="button button--primary" disabled={saving}>{saving ? "Saving…" : "Save"}</button>
        </div>
      </form>
    </dialog>
  );
}

function DeleteDialog({ project, onClose, onDeleted, onStale, onGone }: DialogProps & { onDeleted: (id: string) => void }) {
  const ref = useModal(project !== null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const key = useRef<string>("");
  useEffect(() => {
    if (project) {
      setError(null);
      key.current = newKey();
    }
  }, [project]);

  async function confirm() {
    if (!project || busy) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/projects/${project.id}`, {
        method: "DELETE",
        body: { expectedRevision: project.revision, confirm: true },
        idempotencyKey: key.current,
      });
      onDeleted(project.id);
    } catch (caught) {
      setError(conflictMessage(caught, project, onStale, onGone));
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog ref={ref} className="dialog" onClose={onClose} aria-labelledby="delete-title" aria-describedby="delete-description">
      <h2 id="delete-title">Delete “{project?.title}”?</h2>
      <div id="delete-description">
        <p className="muted">The video and its drafts will be removed from your workspace. This can’t be undone.</p>
        <ul className="help-list">
          <li>Any video generation in progress for it is cancelled.</li>
          <li>Pending schedules are cancelled. Posts already published on Instagram are not removed.</li>
        </ul>
      </div>
      {error && <div className="notice notice--error" role="alert">{error}</div>}
      <div className="dialog-actions">
        <button type="button" className="button button--secondary" onClick={onClose} autoFocus>Cancel</button>
        <button type="button" className="button button--danger" onClick={confirm} disabled={busy}>{busy ? "Deleting…" : "Delete video"}</button>
      </div>
    </dialog>
  );
}
