import fs from "node:fs";
import path from "node:path";

// Public HTTPS origin through which Instagram fetches approved MP4s (media gateway only). Configured with
// MEDIA_PUBLIC_ORIGIN, or written by `npm run media-tunnel` to apps/web/.runtime/media-origin while a tunnel runs.
// Without it, publishing is unavailable (Instagram cannot reach a local machine).

export function mediaPublicOrigin(env: Record<string, string | undefined> = process.env): string | null {
  const candidates = [env.MEDIA_PUBLIC_ORIGIN?.trim()];
  // MEDIA_ORIGIN_FILE="" disables the tunnel file (tests must not depend on a tunnel running on this machine).
  const file = env.MEDIA_ORIGIN_FILE ?? path.join(process.cwd(), ".runtime", "media-origin");
  if (file) {
    try {
      candidates.push(fs.readFileSync(file, "utf8").trim());
    } catch {
      // No tunnel running.
    }
  }
  for (const value of candidates) {
    if (!value) continue;
    try {
      const url = new URL(value);
      if (url.protocol === "https:" && url.pathname === "/" && !url.search && !["localhost", "127.0.0.1"].includes(url.hostname)) return url.origin;
    } catch {
      // ignore malformed values
    }
  }
  return null;
}
