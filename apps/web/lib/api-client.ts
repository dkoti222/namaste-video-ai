"use client";

import { signInPath } from "./return-path";

// Browser helper for the JSON API envelopes. Session loss sends the user to sign-in with a return path.

export class ClientApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = "ClientApiError";
  }
}

type Envelope<T> = { data: T; page?: { nextCursor: string | null; hasMore: boolean } };

export async function apiFetch<T>(path: string, init: { method?: string; body?: unknown; idempotencyKey?: string } = {}): Promise<Envelope<T>> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: init.method ?? "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(init.idempotencyKey ? { "Idempotency-Key": init.idempotencyKey } : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new ClientApiError(0, "NETWORK_ERROR", "You appear to be offline. Check your connection and try again.");
  }

  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  if (response.ok) return (payload ?? { data: undefined }) as Envelope<T>;

  const error = payload?.error ?? {};
  if (response.status === 401) {
    window.location.assign(signInPath(window.location.pathname + window.location.search, "expired"));
    return new Promise(() => {}); // navigation in progress
  }
  if (response.status === 403 && error.code === "ACCESS_DISABLED") {
    window.location.assign("/sign-in/help?reason=unavailable");
    return new Promise(() => {});
  }
  throw new ClientApiError(
    response.status,
    error.code ?? "INTERNAL_ERROR",
    error.message ?? "Something went wrong. Try again.",
    error.fieldErrors ? { ...(error.details ?? {}), fieldErrors: error.fieldErrors } : error.details,
    error.requestId,
  );
}
