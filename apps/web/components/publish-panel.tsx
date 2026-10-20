"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, ClientApiError } from "@/lib/api-client";
import type { PublishIntentView } from "@/server/publish/service";
import type { VideoView } from "@/server/videos/service";
import { Button } from "./ui";
import { Player } from "./video-review";

// Publish step (screens 12 / 26, Post now): pick the approved version, see the exact account, write the caption,
// review everything in one confirmation, then follow the real delivery status. Scheduling is F20.

type Account = { connectionId: string; instagramUserId: string; destinationEpoch: number; username: string; type: "BUSINESS" | "CREATOR" };
const CAPTION_MAX = 2200;
const ACTIVE = ["queued", "claimed", "preparing", "processing", "submitting", "outcome_unknown"];
const clock = (s: number | null) => (s == null ? "" : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`);
const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

function statusText(intent: PublishIntentView): { title: string; detail: string; tone: "progress" | "success" | "error" | "neutral" } {
  switch (intent.state) {
    case "queued":
    case "claimed":
    case "preparing":
      return { title: "Sending the video to Instagram…", detail: "This usually takes under a minute.", tone: "progress" };
    case "processing":
      return { title: "Instagram is processing the video…", detail: "Instagram prepares the Reel before it can be posted. This can take a few minutes.", tone: "progress" };
    case "submitting":
      return { title: "Publishing…", detail: "Confirming the post with Instagram.", tone: "progress" };
    case "published":
      return { title: "Posted to Instagram ✓", detail: intent.publishedAt ? `Published ${when(intent.publishedAt)}.` : "Published.", tone: "success" };
    case "outcome_unknown":
      return { title: "Checking with Instagram…", detail: intent.error?.message ?? "Instagram didn’t confirm the post yet. We won’t post it twice.", tone: "progress" };
    case "paused_auth":
      return { title: "Paused — reconnect Instagram", detail: intent.error?.message ?? "Reconnect the same Instagram account in Settings, then retry.", tone: "error" };
    case "failed_safe":
      return { title: "Not posted", detail: intent.error?.message ?? "Nothing was posted. You can retry.", tone: "error" };
    case "needs_attention":
      return { title: "Needs your attention", detail: intent.error?.message ?? "Check your Instagram profile before posting again.", tone: "error" };
    case "cancelled":
      return { title: "Cancelled", detail: "Nothing was posted.", tone: "neutral" };
    default:
      return { title: intent.state, detail: "", tone: "neutral" };
  }
}

function IntentCard({ initial, onChange }: { initial: PublishIntentView; onChange: (intent: PublishIntentView) => void }) {
  const [intent, setIntent] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const status = statusText(intent);

  useEffect(() => setIntent(initial), [initial]);
  useEffect(() => {
    if (!ACTIVE.includes(intent.state)) return;
    const timer = setTimeout(async () => {
      try {
        const { data } = await apiFetch<PublishIntentView>(`/api/publish-intents/${intent.id}`);
        setIntent(data);
        onChange(data);
      } catch {
        // Keep polling on transient errors.
        setIntent((current) => ({ ...current }));
      }
    }, intent.state === "outcome_unknown" ? 15_000 : 3_000);
    return () => clearTimeout(timer);
  }, [intent, onChange]);

  async function act(action: "cancel" | "retry") {
    setBusy(true);
    setError(null);
    try {
      const { data } = await apiFetch<PublishIntentView>(`/api/publish-intents/${intent.id}/${action}`, {
        method: "POST",
        body: action === "retry" ? { expectedRevision: intent.revision, confirm: true } : { expectedRevision: intent.revision },
        idempotencyKey: crypto.randomUUID(),
      });
      setIntent(data);
      onChange(data);
    } catch (caught) {
      setError(caught instanceof ClientApiError ? caught.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className={`publish-status publish-status--${status.tone}`} aria-live="polite">
      <div className="publish-status-head">
        {status.tone === "progress" && <span className="spinner" aria-hidden="true" />}
        <h3>{status.title}</h3>
      </div>
      <p className="muted">{status.detail}</p>
      <p className="publish-meta">To <strong>@{intent.destination.usernameAtApproval}</strong> · {when(intent.createdAt)}</p>
      {intent.caption && <p className="publish-caption">{intent.caption}</p>}
      <div className="publish-actions">
        {intent.state === "published" && (intent.permalink ? <a className="button button--primary" href={intent.permalink} target="_blank" rel="noopener noreferrer">View on Instagram ↗</a> : <span className="hint">The post is live; its link isn’t available yet.</span>)}
        {intent.actions.retry && <Button onClick={() => act("retry")} disabled={busy}>Retry posting</Button>}
        {intent.actions.reconnect && <a className="button button--secondary" href="/settings">Open Settings</a>}
        {intent.actions.cancel && <Button variant="secondary" onClick={() => act("cancel")} disabled={busy}>{intent.state === "queued" ? "Cancel" : "Dismiss"}</Button>}
      </div>
      {error && <p className="notice notice--error" role="alert">{error}</p>}
    </article>
  );
}

export function PublishPanel({
  projectId,
  versions,
  initialVideoId,
  account,
  available,
  defaultCaption,
  initialIntents,
}: {
  projectId: string;
  versions: (VideoView & { number: number })[];
  initialVideoId: string | null;
  account: Account | null;
  available: boolean;
  defaultCaption: string;
  initialIntents: PublishIntentView[];
}) {
  const approved = versions.filter((v) => v.state === "approved");
  const [videoId, setVideoId] = useState(initialVideoId && approved.some((v) => v.id === initialVideoId) ? initialVideoId : approved[0]?.id ?? null);
  const [caption, setCaption] = useState(defaultCaption);
  const [intents, setIntents] = useState(initialIntents);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [repostOf, setRepostOf] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const video = approved.find((v) => v.id === videoId) ?? null;
  const length = [...caption].length;
  const active = intents.find((i) => ACTIVE.includes(i.state));
  const canPost = Boolean(video && account && available && length <= CAPTION_MAX && !active);

  const update = useCallback((next: PublishIntentView) => setIntents((list) => list.map((i) => (i.id === next.id ? next : i))), []);

  async function postNow(repostOfIntentId?: string) {
    if (!video || !account) return;
    setBusy(true);
    setError(null);
    setRepostOf(null);
    try {
      const { data } = await apiFetch<PublishIntentView>("/api/publish-intents", {
        method: "POST",
        body: {
          projectId,
          payload: {
            videoId: video.id,
            videoApprovalId: video.approvalId,
            expectedOutputHash: video.outputHash,
            destination: { connectionId: account.connectionId, instagramUserId: account.instagramUserId, destinationEpoch: account.destinationEpoch },
            caption,
          },
          mode: "now",
          confirm: true,
          ...(repostOfIntentId ? { repostOfIntentId } : {}),
        },
        idempotencyKey: crypto.randomUUID(),
      });
      setIntents((list) => [data, ...list.filter((i) => i.id !== data.id)]);
      dialog.current?.close();
    } catch (caught) {
      setError(caught instanceof ClientApiError ? caught.message : "The post couldn’t be started. Try again.");
      // Same video + account + caption already posted: offer an explicit, confirmed repost.
      if (caught instanceof ClientApiError && caught.code === "ALREADY_PUBLISHED" && typeof caught.details?.intentId === "string") setRepostOf(caught.details.intentId);
      dialog.current?.close();
    } finally {
      setBusy(false);
    }
  }

  if (approved.length === 0) {
    return (
      <section className="state-panel">
        <h2>Approve a video first</h2>
        <p className="muted">Only a video version you’ve approved can be posted.</p>
        <a className="button button--primary" href={`/projects/${projectId}/video`}>Go to the video</a>
      </section>
    );
  }

  return (
    <div className="publish">
      <div className="publish-preview">{video && <Player video={video} />}</div>
      <div className="publish-form">
        {!available && <p className="notice notice--error" role="alert">Posting isn’t available right now: Instagram needs a temporary public link to download the video, and it isn’t running. You can still download the MP4 from the Video step.</p>}
        {active && <IntentCard initial={active} onChange={update} />}

        <section className="review-panel" aria-labelledby="post-heading">
          <h2 id="post-heading">Post to Instagram</h2>
          <div className="field">
            <label htmlFor="publish-version">Video</label>
            <select id="publish-version" className="select" value={videoId ?? ""} onChange={(e) => setVideoId(e.target.value)}>
              {approved.map((v) => (
                <option key={v.id} value={v.id}>Version {v.number} · {clock(v.durationSeconds)} · approved</option>
              ))}
            </select>
            <p className="hint">Only approved versions are listed. The post uses exactly this file.</p>
          </div>
          <div className="field">
            <span className="label">Instagram account</span>
            {account ? (
              <p className="publish-account"><strong>@{account.username}</strong> <span className="muted">· {account.type === "BUSINESS" ? "Business" : "Creator"} account</span></p>
            ) : (
              <p className="notice">Connect Instagram first. <a className="text-link" href="/settings">Open Settings →</a></p>
            )}
          </div>
          <div className="field">
            <label htmlFor="publish-caption">Caption</label>
            <textarea id="publish-caption" rows={5} value={caption} onChange={(e) => setCaption(e.target.value)} aria-describedby="publish-caption-count" />
            <p id="publish-caption-count" className={length > CAPTION_MAX ? "hint hint--error" : "hint"}>{length.toLocaleString("en-IN")} / {CAPTION_MAX.toLocaleString("en-IN")} characters</p>
          </div>
          <Button onClick={() => dialog.current?.showModal()} disabled={!canPost}>Review post…</Button>
          {active && <p className="hint">A post is in progress. You can post again once it finishes.</p>}
          {error && (
            <div className="notice notice--error" role="alert">
              {error}
              {repostOf && (
                <p>
                  <Button variant="secondary" onClick={() => postNow(repostOf)} disabled={busy}>Post it again to @{account?.username}</Button>
                </p>
              )}
            </div>
          )}
        </section>

        {intents.filter((i) => i.id !== active?.id).length > 0 && (
          <section className="publish-history" aria-labelledby="history-heading">
            <h2 id="history-heading">Earlier posts</h2>
            {intents.filter((i) => i.id !== active?.id).map((intent) => <IntentCard key={intent.id} initial={intent} onChange={update} />)}
          </section>
        )}
      </div>

      <dialog ref={dialog} className="dialog" aria-labelledby="confirm-post-title">
        <h2 id="confirm-post-title">Post now to @{account?.username}?</h2>
        <dl className="confirm-list">
          <dt>Video</dt>
          <dd>Version {video?.number} · {clock(video?.durationSeconds ?? null)}</dd>
          <dt>Account</dt>
          <dd>@{account?.username}</dd>
          <dt>Caption</dt>
          <dd className="publish-caption">{caption || <span className="muted">(no caption)</span>}</dd>
        </dl>
        <p className="muted">This posts publicly as a Reel right away. Instagram can take a few minutes to process it.</p>
        <div className="dialog-actions">
          <Button variant="secondary" onClick={() => dialog.current?.close()}>Back</Button>
          <Button onClick={() => postNow()} disabled={busy}>{busy ? "Starting…" : "Post now"}</Button>
        </div>
      </dialog>
    </div>
  );
}
