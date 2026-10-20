import { isAPIError } from "better-auth/api";
import { z } from "zod";
import { sha256Hex } from "../../lib/canonical";
import { ApiError, jsonData, noContent, readJson, requireOrigin } from "../http";
import { isAdmitted, normalizeEmail } from "./access";
import type { AuthServices } from "./auth";
import { loginRetryAfter, recordLoginFailure } from "./rate-limit";

// Session facade (API_DESIGN.md section 3). Better Auth performs password and session work; this layer adds
// Origin checks, admission, throttling, generic errors and the documented SessionView.

export type SessionView = {
  user: { id: string; email: string; name: string };
  expiresAt: string;
  workspaceId: string;
  capabilities: { generation: boolean; instagramPublishing: boolean };
};

const signInBody = z.strictObject({ email: z.string().max(254), password: z.string().min(1).max(128) });

const invalidCredentials = () => new ApiError(401, "INVALID_CREDENTIALS", "The email or password is incorrect.");

function toView(user: { id: string; email: string; name: string }, expiresAt: Date): SessionView {
  return {
    user: { id: user.id, email: user.email, name: user.name },
    expiresAt: expiresAt.toISOString(),
    workspaceId: user.id,
    // Generation and publishing are not implemented yet (F13+, F18+); they are not advertised as available.
    capabilities: { generation: false, instagramPublishing: false },
  };
}

function setCookieHeaders(source: Headers): Headers {
  const headers = new Headers();
  for (const cookie of source.getSetCookie()) headers.append("Set-Cookie", cookie);
  return headers;
}

/** Client IP for throttling only. Trusted when the app runs behind a proxy that sets X-Forwarded-For. */
export function clientIp(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip")?.trim() || "unknown";
}

export async function signIn(request: Request, services: AuthServices, requestId: string): Promise<Response> {
  requireOrigin(request, services.config.origin);
  const body = await readJson(request, signInBody);
  const email = normalizeEmail(body.email);
  const ip = clientIp(request);
  const { db, config, limits, auth } = services;

  const retryAfter = await loginRetryAfter(db, config.secret, email, ip, limits);
  if (retryAfter !== null) {
    throw new ApiError(429, "RATE_LIMITED", "Too many sign-in attempts. Wait a few minutes and try again.", {
      retryable: true,
      headers: { "Retry-After": String(retryAfter) },
    });
  }

  let result;
  try {
    result = await auth.api.signInEmail({
      body: { email, password: body.password, rememberMe: true },
      headers: request.headers,
      returnHeaders: true,
    });
  } catch (error) {
    // Wrong password, unknown email, invalid format and missing admission are indistinguishable to the client.
    if (isAPIError(error) && error.statusCode >= 400 && error.statusCode < 500) {
      await recordLoginFailure(db, config.secret, email, ip, limits);
      throw invalidCredentials();
    }
    throw error;
  }

  const context = await auth.$context;
  const created = await context.internalAdapter.findSession(result.response.token);
  if (!created) throw new Error("Session was not persisted after sign-in");
  return jsonData(requestId, toView(created.user, created.session.expiresAt), { headers: setCookieHeaders(result.headers) });
}

/** sessionHash: SHA-256 of the server session ID, used to bind one-use flows (OAuth state) to this sign-in. */
export async function currentSession(request: Request, services: AuthServices): Promise<{ view: SessionView; headers: Headers; sessionHash: string }> {
  const { auth, db } = services;
  const result = await auth.api.getSession({ headers: request.headers, returnHeaders: true });
  const data = result.response;
  if (!data) {
    const cookieName = (await auth.$context).authCookies.sessionToken.name;
    const hadCookie = (request.headers.get("cookie") ?? "").split(";").some((part) => part.trim().startsWith(`${cookieName}=`));
    throw hadCookie
      ? new ApiError(401, "SESSION_EXPIRED", "Your session has ended. Sign in again.")
      : new ApiError(401, "UNAUTHENTICATED", "Sign in to continue.");
  }
  // Access is revalidated on every private request, not only at sign-in.
  if (!(await isAdmitted(db, data.user.id))) {
    throw new ApiError(403, "ACCESS_DISABLED", "Your access to NamasteVideo is disabled. Contact the operator.");
  }
  return { view: toView(data.user, data.session.expiresAt), headers: setCookieHeaders(result.headers), sessionHash: sha256Hex(`session:${data.session.id}`) };
}

export async function getSessionResponse(request: Request, services: AuthServices, requestId: string): Promise<Response> {
  const { view, headers } = await currentSession(request, services);
  return jsonData(requestId, view, { headers });
}

/** Ends this session and expires the cookie. Idempotent; accepted jobs are unaffected. */
export async function signOut(request: Request, services: AuthServices, requestId: string): Promise<Response> {
  requireOrigin(request, services.config.origin);
  const result = await services.auth.api.signOut({ headers: request.headers, returnHeaders: true });
  return noContent(requestId, setCookieHeaders(result.headers));
}
