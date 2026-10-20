import type { AuthServices } from "./auth/auth";
import { currentSession } from "./auth/session";
import { requireOrigin } from "./http";

export type Owner = { ownerId: string; sessionHash: string };

/**
 * Authenticates a private API request: valid session and enabled access (401/403 otherwise). Cookie-authenticated
 * mutations also require the exact app Origin. The owner always comes from the session, never from the request.
 */
export async function requireApiOwner(request: Request, services: AuthServices, { mutation }: { mutation: boolean }): Promise<Owner> {
  if (mutation) requireOrigin(request, services.config.origin);
  const { view, sessionHash } = await currentSession(request, services);
  return { ownerId: view.user.id, sessionHash };
}
