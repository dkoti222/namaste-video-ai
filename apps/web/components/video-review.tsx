"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch, ClientApiError } from "@/lib/api-client";
import type { VideoView } from "@/server/videos/service";
import { VideoProgress } from "./video-progress";
import { VideoTabs, type StoryboardInfo } from "./video-tabs";

// Video review (screens 11 / 21): version switcher, vertical player, download, exact-version approval.
// Caption edits and visual revisions are F16; posting happens on the Publish step (F19).

type JobView = Parameters<typeof VideoProgress>[0]["initial"];
const READY = ["ready_for_review", "approved"];
const clock = (s: number | null) => (s == null ? "" : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`);
const ago = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

function stateLabel(video: VideoView) {
  if (video.state === "approved") return "Approved";
  if (video.state === "ready_for_review") return "Ready for review";
  if (video.state === "failed") return "Not completed";
  return "Generating";
}

export function Player({ video }: { video: VideoView }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => {
    setError(null);
    apiFetch<{ url: string }>(`/api/assets/${video.outputAssetId}/access`, { method: "POST", body: { purpose: "preview" } })
      .then(({ data }) => setUrl(data.url))
      .catch((caught) => setError(caught instanceof ClientApiError ? caught.message : "The video couldn’t be loaded."));
  };
  useEffect(load, [video.outputAssetId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (error) return <div className="notice notice--error" role="alert">{error} <button type="button" className="text-link" onClick={load}>Retry</button></div>;
  if (!url) return <div className="player player--loading" aria-busy="true" aria-label="Loading video" />;
  // Grants expire after 10 minutes; a playback error after that fetches a fresh one.
  return <video key={url} className="player" src={url} controls playsInline preload="metadata" onError={() => setTimeout(load, 500)} aria-label={`Video version, ${clock(video.durationSeconds)}`} />;
}

export function VideoReview({ projectId, versions, jobs, storyboards = {} }: { projectId: string; versions: VideoView[]; jobs: Record<string, JobView>; storyboards?: Record<string, StoryboardInfo> }) {
  const initial = versions.find((v) => READY.includes(v.state)) ?? versions[0];
  const [selectedId, setSelectedId] = useState(initial.id);
  const [list, setList] = useState(versions);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const selected = list.find((v) => v.id === selectedId) ?? list[0];
  const number = (video: VideoView) => list.length - list.indexOf(video);
  const newest = list[0];

  async function download() {
    setError(null);
    try {
      const { data } = await apiFetch<{ url: string }>(`/api/assets/${selected.outputAssetId}/access`, { method: "POST", body: { purpose: "download" } });
      window.location.assign(data.url);
    } catch (caught) {
      setError(caught instanceof ClientApiError ? caught.message : "The download couldn’t start.");
    }
  }

  async function approve() {
    if (!selected.outputHash) return;
    setBusy(true);
    setError(null);
    try {
      const { data } = await apiFetch<{ id: string }>(`/api/videos/${selected.id}/approve`, {
        method: "POST",
        body: { expectedOutputHash: selected.outputHash, expectedRenderSpecHash: selected.renderSpecHash, approve: true },
        idempotencyKey: crypto.randomUUID(),
      });
      setList((current) => current.map((v) => (v.id === selected.id ? { ...v, state: "approved", approvalId: data.id } : v)));
      dialog.current?.close();
      // "Approve & continue to publish": go straight to the Publish step for this exact version.
      window.location.assign(`/projects/${projectId}/publish?video=${selected.id}`);
    } catch (caught) {
      setError(caught instanceof ClientApiError ? caught.message : "The video couldn’t be approved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="review">
      {newest.id !== selected.id && !READY.includes(newest.state) && newest.state !== "failed" && (
        <p className="notice" role="status">Version {number(newest)} is being generated. You can review version {number(selected)} meanwhile.</p>
      )}
      <div className="versions" role="tablist" aria-label="Video versions">
        {list.map((video) => (
          <button
            key={video.id}
            type="button"
            role="tab"
            aria-selected={video.id === selected.id}
            className="version-tab"
            onClick={() => setSelectedId(video.id)}
          >
            <strong>v{number(video)}</strong>
            {video === newest && <span className="muted"> · latest</span>}
            <span className={`chip ${video.state === "approved" ? "chip--done" : video.state === "failed" ? "chip--warning" : ""}`}>{stateLabel(video)}</span>
          </button>
        ))}
      </div>

      {READY.includes(selected.state) && selected.outputAssetId ? (
        <div className="review-layout">
          <div className="review-player">
            <Player video={selected} />
          </div>
          <section className="panel review-panel" aria-labelledby="review-heading">
            <h2 id="review-heading">Version {number(selected)} · {clock(selected.durationSeconds)}</h2>
            <dl className="facts">
              <div><dt>Created</dt><dd>{ago(selected.createdAt)}</dd></div>
              <div><dt>Narrator</dt><dd>{selected.voice.label}{selected.voice.testOnly && !/test voice/i.test(selected.voice.label) ? " (test voice)" : ""}</dd></div>
              <div><dt>Format</dt><dd>1080 × 1920 · 30 fps · MP4</dd></div>
              <div><dt>Automatic checks</dt><dd>{selected.qa?.passed ? "Passed" : "Not passed"}</dd></div>
            </dl>
            <p className="hint">Automatic checks cover format, length, audio and captions. Watch and listen to the whole video before approving: they can’t judge accuracy or how it sounds.</p>
            {error && <div className="notice notice--error" role="alert">{error}</div>}
            <div className="actions">
              <button type="button" className="button button--secondary" onClick={download}>Download MP4</button>
              {selected.state === "approved" ? (
                <span className="approved-badge" role="status">✓ Approved for publishing</span>
              ) : (
                <button type="button" className="button button--primary" onClick={() => dialog.current?.showModal()}>Approve &amp; continue to publish →</button>
              )}
            </div>
            {selected.state === "approved" && (
              <p>
                <a className="button button--primary" href={`/projects/${projectId}/publish?video=${selected.id}`}>Continue to publish →</a>
              </p>
            )}
          </section>
          <div className="review-tabs-wrap">
            <VideoTabs video={selected} projectId={projectId} storyboard={storyboards[selected.storyboardId] ?? null} />
          </div>
        </div>
      ) : jobs[selected.id] ? (
        <VideoProgress projectId={projectId} initial={jobs[selected.id]} />
      ) : (
        <p className="notice">This version has no output.</p>
      )}

      <dialog ref={dialog} className="dialog" aria-labelledby="approve-video-title">
        <h2 id="approve-video-title">Approve version {number(selected)}?</h2>
        <p className="muted">You’re approving exactly this video ({clock(selected.durationSeconds)}) for publishing. Later versions will need their own approval.</p>
        {error && <div className="notice notice--error" role="alert">{error}</div>}
        <div className="dialog-actions">
          <button type="button" className="button button--secondary" onClick={() => dialog.current?.close()}>Keep reviewing</button>
          <button type="button" className="button button--primary" onClick={approve} disabled={busy}>{busy ? "Approving…" : "Approve video"}</button>
        </div>
      </dialog>
    </div>
  );
}
