"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch, ClientApiError } from "@/lib/api-client";
import { Button } from "./ui";

type Connection = {
  id: string;
  revision: number;
  state: "connected" | "expiring" | "reconnect_required" | "disconnected";
  account: { id: string; username: string; type: "BUSINESS" | "CREATOR" } | null;
  expiresAt: string | null;
  pendingIntentCount: number;
};

const OUTCOMES: Record<string, { tone: "success" | "error"; text: string }> = {
  connected: { tone: "success", text: "Instagram connected." },
  cancelled: { tone: "error", text: "Instagram connection was cancelled. Nothing was changed." },
  failed: { tone: "error", text: "Instagram couldn’t be connected. Try again in a moment." },
  expired: { tone: "error", text: "That connection attempt expired. Click Connect to start again." },
  session_lost: { tone: "error", text: "Your sign-in changed during the connection. Click Connect to start again." },
  unsupported_account: { tone: "error", text: "That Instagram account isn’t a Business or Creator account. Switch it to a professional account in the Instagram app, then try again." },
  missing_permissions: { tone: "error", text: "Instagram didn’t grant both permissions (profile and publishing). Connect again and allow both." },
  account_in_use: { tone: "error", text: "That Instagram account is already connected to another NamasteVideo user." },
  reconciliation_pending: { tone: "error", text: "A post to your previous Instagram account is still being confirmed. Try switching accounts after it finishes." },
};

/** Settings → Instagram (I01/I03/I04). Authorization happens on Instagram; we never ask for the password. */
export function InstagramConnection({ initial, configured, outcome, timeZone }: { initial: Connection | null; configured: boolean; outcome: string | null; timeZone: string }) {
  const [connection, setConnection] = useState(initial);
  const [busy, setBusy] = useState<"connect" | "disconnect" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState(outcome ? OUTCOMES[outcome] : undefined);
  // The outcome came from the callback redirect; drop it from the address so a reload doesn't repeat it.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("instagram")) return;
    url.searchParams.delete("instagram");
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  }, []);
  const dialog = useRef<HTMLDialogElement>(null);

  async function connect() {
    setBusy("connect");
    setError(null);
    setNotice(undefined);
    try {
      const { data } = await apiFetch<{ authorizationUrl: string }>("/api/instagram/connect", { method: "POST", body: {} });
      window.location.assign(data.authorizationUrl);
    } catch (err) {
      setError(err instanceof ClientApiError ? err.message : "Something went wrong. Try again.");
      setBusy(null);
    }
  }

  async function disconnect() {
    if (!connection) return;
    setBusy("disconnect");
    setError(null);
    try {
      const { data } = await apiFetch<{ connection: Connection }>("/api/instagram/connection", {
        method: "DELETE",
        body: { expectedRevision: connection.revision, confirmPausePending: true },
        idempotencyKey: crypto.randomUUID(),
      });
      setConnection(data.connection);
      setNotice({ tone: "success", text: "Instagram disconnected. Nothing will be posted to that account." });
      dialog.current?.close();
    } catch (err) {
      setError(err instanceof ClientApiError ? err.message : "Something went wrong. Try again.");
    } finally {
      setBusy(null);
    }
  }

  const active = connection && connection.account && connection.state !== "disconnected";
  const expires = connection?.expiresAt ? new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone }).format(new Date(connection.expiresAt)) : null;

  return (
    <section className="settings-section" aria-labelledby="instagram-heading">
      <h2 id="instagram-heading">Instagram</h2>
      {notice && <p className={`notice ${notice.tone === "success" ? "notice--success" : "notice--error"}`} role={notice.tone === "error" ? "alert" : "status"}>{notice.text}</p>}
      {!configured ? (
        <p className="muted">Instagram connection isn’t set up on this server yet. You can always download your MP4 from the Video step.</p>
      ) : active ? (
        <div className="instagram-account">
          <div>
            <p className="instagram-handle">
              <strong>@{connection.account!.username}</strong>
              <span className={connection.state === "connected" ? "chip chip--done" : "chip chip--warning"}>
                {connection.state === "connected" ? "Connected" : connection.state === "expiring" ? "Expiring soon" : "Reconnect needed"}
              </span>
            </p>
            <p className="muted">
              {connection.account!.type === "BUSINESS" ? "Business account" : "Creator account"}
              {expires ? ` · access renews automatically (current access until ${expires})` : ""}
            </p>
            {connection.state === "reconnect_required" && <p className="notice notice--error" role="alert">Instagram access has ended. Reconnect to publish again.</p>}
            <p className="hint">Posting from the Publish step arrives in a later update. Nothing is posted without your approval.</p>
          </div>
          <div className="instagram-actions">
            {connection.state !== "connected" && <Button onClick={connect} disabled={busy !== null}>{busy === "connect" ? "Opening Instagram…" : "Reconnect"}</Button>}
            <Button variant="secondary" onClick={() => dialog.current?.showModal()} disabled={busy !== null}>Disconnect</Button>
          </div>
        </div>
      ) : (
        <>
          <p className="muted">Connect your Instagram Business or Creator account to post approved videos. You’ll log in on Instagram — NamasteVideo never sees your password.</p>
          <Button onClick={connect} disabled={busy !== null}>{busy === "connect" ? "Opening Instagram…" : "Connect Instagram"}</Button>
        </>
      )}
      {error && <p className="notice notice--error" role="alert">{error}</p>}

      {active && (
      <dialog ref={dialog} className="dialog" aria-labelledby="disconnect-title">
        <h2 id="disconnect-title">Disconnect @{connection?.account?.username}?</h2>
        <p className="muted">NamasteVideo will stop posting to this account.{connection && connection.pendingIntentCount > 0 ? ` ${connection.pendingIntentCount} scheduled post(s) will be paused.` : ""} Your videos and downloads aren’t affected, and you can reconnect any time.</p>
        <div className="dialog-actions">
          <Button variant="secondary" onClick={() => dialog.current?.close()}>Keep connected</Button>
          <Button onClick={disconnect} disabled={busy !== null}>{busy === "disconnect" ? "Disconnecting…" : "Disconnect"}</Button>
        </div>
      </dialog>
      )}
    </section>
  );
}
