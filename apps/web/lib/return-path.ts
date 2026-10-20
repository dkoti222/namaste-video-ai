// Validated relative return paths for sign-in redirects (SYSTEM_DESIGN.md section 4). Shared by server and client.

export const DEFAULT_RETURN_PATH = "/videos";
const BASE = "http://return-path.invalid";

/** Returns a same-origin relative path, or the default when the input could leave the app or loop to sign-in. */
export function safeReturnPath(raw: string | null | undefined): string {
  if (!raw || raw.length > 512 || !raw.startsWith("/") || raw.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(raw)) {
    return DEFAULT_RETURN_PATH;
  }
  let url: URL;
  try {
    url = new URL(raw, BASE);
  } catch {
    return DEFAULT_RETURN_PATH;
  }
  if (url.origin !== BASE || /^\/(api|sign-in)(\/|$)/.test(url.pathname)) return DEFAULT_RETURN_PATH;
  return `${url.pathname}${url.search}${url.hash}`;
}

export function signInPath(returnPath: string, reason?: "expired"): string {
  const params = new URLSearchParams({ next: safeReturnPath(returnPath) });
  if (reason) params.set("reason", reason);
  return `/sign-in?${params}`;
}
