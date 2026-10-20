"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";

type ApiFailure = { code?: string; requestId?: string; retryAfter?: number };

function messageFor(failure: ApiFailure): string {
  switch (failure.code) {
    case "INVALID_CREDENTIALS":
      return "Invalid email or password. Check your details, or contact your administrator if your access has changed.";
    case "RATE_LIMITED": {
      const minutes = Math.max(1, Math.ceil((failure.retryAfter ?? 900) / 60));
      return `Too many sign-in attempts. Wait about ${minutes} minute${minutes === 1 ? "" : "s"} and try again.`;
    }
    case "VALIDATION_FAILED":
      return "Enter your email and password.";
    case "ORIGIN_NOT_ALLOWED":
      return "This page is out of date. Reload it and try again.";
    default:
      return "Sign-in is temporarily unavailable. Try again in a moment.";
  }
}

async function readFailure(response: Response): Promise<ApiFailure> {
  const retryAfter = Number(response.headers.get("retry-after")) || undefined;
  try {
    const body = await response.json();
    return { code: body?.error?.code, requestId: body?.error?.requestId, retryAfter };
  } catch {
    return { retryAfter };
  }
}

export function SignInForm({ next }: { next: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    if (!email.trim() || !password) {
      setFailure({ code: "VALIDATION_FAILED" });
      return;
    }
    setSubmitting(true);
    setFailure(null);
    try {
      const response = await fetch("/api/session/sign-in", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (response.ok) {
        router.replace(next);
        router.refresh();
        return;
      }
      setFailure(await readFailure(response));
    } catch {
      setFailure({});
    }
    setPassword("");
    setSubmitting(false);
    passwordRef.current?.focus();
  }

  const showReference = failure && !["INVALID_CREDENTIALS", "RATE_LIMITED", "VALIDATION_FAILED"].includes(failure.code ?? "");

  return (
    <form className="auth-form" onSubmit={submit} noValidate>
      {failure && (
        <div className="notice notice--error" role="alert">
          {messageFor(failure)}
          {showReference && failure.requestId && <p className="hint">Reference: {failure.requestId}</p>}
        </div>
      )}
      <div className="field">
        <label htmlFor="email">Work email</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          inputMode="email"
          maxLength={254}
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="password">Password</label>
        <div className="password-input">
          <input
            id="password"
            name="password"
            ref={passwordRef}
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            maxLength={128}
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <button
            type="button"
            className="password-toggle"
            aria-controls="password"
            aria-pressed={showPassword}
            onClick={() => setShowPassword((value) => !value)}
          >
            {showPassword ? "Hide" : "Show"}
          </button>
        </div>
      </div>
      <button type="submit" className="button button--primary button--block" disabled={submitting} aria-busy={submitting}>
        {submitting ? "Signing in…" : "Sign in →"}
      </button>
      <Link className="text-link" href="/sign-in/help">Need help signing in?</Link>
    </form>
  );
}

export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function signOut() {
    setBusy(true);
    setFailed(false);
    try {
      const response = await fetch("/api/session/sign-out", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (response.status === 204) {
        router.replace("/sign-in");
        router.refresh();
        return;
      }
    } catch {
      // Network failure: fall through to the inline error.
    }
    setFailed(true);
    setBusy(false);
  }

  return (
    <span className="sign-out">
      <button type="button" className="button button--secondary button--small" onClick={signOut} disabled={busy}>
        {busy ? "Signing out…" : "Sign out"}
      </button>
      {failed && <span className="sign-out-error" role="alert">Couldn’t sign out. Try again.</span>}
    </span>
  );
}
