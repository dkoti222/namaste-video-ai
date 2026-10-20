"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { apiFetch, ClientApiError } from "@/lib/api-client";
import { browserTimezone, timezoneList, utcOffsetLabel } from "@/lib/timezones";
import { SignOutButton } from "./auth-forms";
import { Button } from "./ui";

type Voice = { preset: string; label: string; accent: string; testOnly: boolean; sampleUrl: string | null };
type Preferences = { revision: number; timezone: string | null; defaultVoicePreset: string };

/** Screens 06 / 24: personal timezone and future-project voice. Saved explicitly; existing projects never change. */
export function SettingsForm({ email, initial, voices, instagram }: { email: string; initial: Preferences; voices: Voice[]; instagram?: ReactNode }) {
  const [saved, setSaved] = useState(initial);
  const [timezone, setTimezone] = useState(initial.timezone ?? "");
  const [voice, setVoice] = useState(initial.defaultVoicePreset);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error" | "conflict">("idle");
  const [error, setError] = useState<string | null>(null);
  const signOutDialog = useRef<HTMLDialogElement>(null);

  // The zone list and offsets come from the browser's own timezone data (it can differ from the server's), so they
  // are built after hydration. Not saved yet: suggest the browser timezone.
  const [mounted, setMounted] = useState(false);
  const [suggested, setSuggested] = useState("");
  useEffect(() => {
    setMounted(true);
    if (!initial.timezone) {
      const zone = browserTimezone();
      setSuggested(zone);
      setTimezone(zone);
    }
  }, [initial.timezone]);

  const zones = useMemo(() => {
    if (!mounted) return timezone ? [timezone] : [];
    const list = timezoneList();
    return timezone && !list.includes(timezone) ? [timezone, ...list] : list;
  }, [mounted, timezone]);
  const offsets = useMemo(() => new Map(mounted ? zones.map((zone) => [zone, utcOffsetLabel(zone)]) : []), [mounted, zones]);

  // "edited" = the user changed something (drives warnings); "savable" also covers saving a browser suggestion.
  const baselineZone = saved.timezone ?? suggested;
  const edited = timezone !== baselineZone || voice !== saved.defaultVoicePreset;
  const savable = edited || (saved.timezone === null && timezone !== "");
  const voiceMissing = !voices.some((v) => v.preset === voice);

  useEffect(() => {
    if (!edited) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [edited]);

  async function save() {
    setStatus("saving");
    setError(null);
    try {
      const body: Record<string, unknown> = { expectedRevision: saved.revision };
      if (timezone !== (saved.timezone ?? "")) body.timezone = timezone;
      if (voice !== saved.defaultVoicePreset || saved.revision === 0) body.defaultVoicePreset = voice;
      const { data } = await apiFetch<Preferences>("/api/preferences", { method: "PATCH", body });
      setSaved(data);
      setTimezone(data.timezone ?? "");
      setVoice(data.defaultVoicePreset);
      setStatus("saved");
    } catch (err) {
      if (err instanceof ClientApiError && err.code === "REVISION_CONFLICT") {
        setStatus("conflict");
        setError("Your settings changed in another tab or device.");
      } else {
        setStatus("error");
        setError(err instanceof ClientApiError ? err.message : "Something went wrong. Try again.");
      }
    }
  }

  async function reload() {
    try {
      const { data } = await apiFetch<Preferences>("/api/preferences");
      setSaved(data);
      setTimezone(data.timezone ?? browserTimezone());
      setVoice(data.defaultVoicePreset);
      setStatus("idle");
      setError(null);
    } catch (err) {
      setError(err instanceof ClientApiError ? err.message : "Something went wrong. Try again.");
    }
  }

  return (
    <div className="settings">
      <header className="settings-header">
        <h1>Settings</h1>
        <p className="muted">Personal to your account. Nothing here changes videos you’ve already made.</p>
      </header>

      <section className="settings-section" aria-labelledby="account-heading">
        <h2 id="account-heading">Account</h2>
        <div className="field">
          <label htmlFor="settings-email">Email</label>
          <input id="settings-email" type="email" value={email} readOnly aria-describedby="settings-email-hint" />
          <p id="settings-email-hint" className="hint">Access is managed by your administrator.</p>
        </div>
        <div className="field">
          <label htmlFor="settings-timezone">Timezone</label>
          <select id="settings-timezone" className="select" value={timezone} onChange={(e) => { setTimezone(e.target.value); setStatus("idle"); }} aria-describedby="settings-timezone-hint">
            {zones.map((zone) => (
              <option key={zone} value={zone}>{zone.replaceAll("_", " ")}{offsets.get(zone) ? ` (${offsets.get(zone)})` : ""}</option>
            ))}
          </select>
          <p id="settings-timezone-hint" className="hint">
            {saved.timezone ? "Used for dates in your library and, later, for scheduled posts." : "Suggested from this browser — not saved yet. Used for dates in your library and, later, for scheduled posts."}
          </p>
        </div>
      </section>

      <section className="settings-section" aria-labelledby="voice-heading">
        <h2 id="voice-heading">Default narrator</h2>
        <p className="muted">Used for new videos you create from now on. Existing videos and drafts keep their own voice.</p>
        <fieldset className="field voices">
          <legend className="visually-hidden">Default narrator</legend>
          {voices.map((v) => (
            <div key={v.preset} className="voice-row">
              <label className="voice-option">
                <input type="radio" name="default-voice" value={v.preset} checked={voice === v.preset} onChange={() => { setVoice(v.preset); setStatus("idle"); }} />
                <span>
                  <strong>{v.label}</strong>
                  <span className="muted"> · {v.accent}{v.testOnly ? " · test voice" : ""}</span>
                </span>
              </label>
              {v.sampleUrl && <audio className="voice-sample" controls preload="none" src={v.sampleUrl} aria-label={`Preview ${v.label}`} />}
            </div>
          ))}
        </fieldset>
        {voiceMissing && <p className="notice notice--error" role="alert">Your saved narrator isn’t available any more. Choose another voice.</p>}
        {voices.some((v) => !v.sampleUrl) && <p className="hint">A preview isn’t available for every voice yet.</p>}
      </section>

      <div className="settings-actions">
        <Button onClick={save} disabled={!savable || voiceMissing || status === "saving"}>{status === "saving" ? "Saving…" : "Save settings"}</Button>
        {edited && status !== "saving" && <Button variant="secondary" onClick={() => { setTimezone(baselineZone); setVoice(saved.defaultVoicePreset); setStatus("idle"); }}>Undo changes</Button>}
        <span className="settings-status" role="status" aria-live="polite">{status === "saved" && !savable ? "✓ Settings saved" : edited ? "Unsaved changes" : ""}</span>
      </div>
      {error && (
        <div className="notice notice--error" role="alert">
          {error}
          {status === "conflict" && <p><button type="button" className="text-link" onClick={reload}>Load the latest settings</button></p>}
        </div>
      )}

      {instagram}

      <section className="settings-section settings-section--signout" aria-labelledby="signout-heading">
        <h2 id="signout-heading">Sign out</h2>
        {edited ? <Button variant="secondary" onClick={() => signOutDialog.current?.showModal()}>Sign out</Button> : <SignOutButton />}
      </section>

      <dialog ref={signOutDialog} className="dialog" aria-labelledby="signout-dialog-title">
        <h2 id="signout-dialog-title">Discard unsaved settings?</h2>
        <p className="muted">Your timezone or narrator changes haven’t been saved.</p>
        <div className="dialog-actions">
          <Button variant="secondary" onClick={() => signOutDialog.current?.close()}>Stay signed in</Button>
          <SignOutButton />
        </div>
      </dialog>
    </div>
  );
}
