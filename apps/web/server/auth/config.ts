// Server-only auth configuration from apps/web/.env.local or the hosting secret store.

export class AuthConfigError extends Error {
  override name = "AuthConfigError";
}

export type AuthConfig = {
  secret: string;
  /** Exact public origin of the web app, e.g. http://127.0.0.1:3000. Used for cookies and Origin checks. */
  origin: string;
};

type Env = Record<string, string | undefined>;

export function readAuthConfig(env: Env = process.env): AuthConfig {
  const secret = env.BETTER_AUTH_SECRET?.trim();
  if (!secret || secret.length < 32) {
    throw new AuthConfigError("Auth is not configured: set BETTER_AUTH_SECRET (at least 32 random characters) in apps/web/.env.local.");
  }
  const rawUrl = env.BETTER_AUTH_URL?.trim();
  if (!rawUrl) throw new AuthConfigError("Auth is not configured: set BETTER_AUTH_URL to the app origin, e.g. http://127.0.0.1:3000.");
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new AuthConfigError("BETTER_AUTH_URL must be an absolute http(s) origin.");
  }
  if (!/^https?:$/.test(url.protocol) || url.pathname !== "/" || url.search || url.hash) {
    throw new AuthConfigError("BETTER_AUTH_URL must be an absolute http(s) origin without a path.");
  }
  return { secret, origin: url.origin };
}
