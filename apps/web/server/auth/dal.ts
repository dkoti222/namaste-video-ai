import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { signInPath } from "@/lib/return-path";
import { ApiError } from "../http";
import { getAuthServices } from "./auth";
import { currentSession, type SessionView } from "./session";

// Data access layer for private pages: every private page calls requirePrivateSession, which re-checks the
// Better Auth session and internal admission on each request (layouts are not relied on for authorization).

type SessionState = { view: SessionView } | { failure: "UNAUTHENTICATED" | "SESSION_EXPIRED" | "ACCESS_DISABLED" };

const readSession = cache(async (): Promise<SessionState> => {
  const services = await getAuthServices();
  const request = new Request(services.config.origin, { headers: new Headers(await headers()) });
  try {
    return { view: (await currentSession(request, services)).view };
  } catch (error) {
    if (error instanceof ApiError && (error.code === "UNAUTHENTICATED" || error.code === "SESSION_EXPIRED" || error.code === "ACCESS_DISABLED")) {
      return { failure: error.code };
    }
    throw error;
  }
});

/** Returns the signed-in, admitted session or redirects: to sign-in (with return path) or to the access help page. */
export async function requirePrivateSession(returnPath: string): Promise<SessionView> {
  const state = await readSession();
  if ("view" in state) return state.view;
  if (state.failure === "ACCESS_DISABLED") redirect("/sign-in/help?reason=unavailable");
  redirect(signInPath(returnPath, state.failure === "SESSION_EXPIRED" ? "expired" : undefined));
}

export async function optionalSession(): Promise<SessionView | null> {
  const state = await readSession();
  return "view" in state ? state.view : null;
}
