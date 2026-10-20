// Temporary public HTTPS link for Instagram to download approved MP4s (F19). Only the media gateway path
// `/api/media/<43-char grant token>` (GET/HEAD) is forwarded to the local app; everything else is 404. The link is a
// Cloudflare quick tunnel (requires `cloudflared`), lives only while this script runs, and is written to
// apps/web/.runtime/media-origin (gitignored) so the app can build ingestion URLs. Stop with Ctrl+C.
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimeDir = path.join(root, ".runtime");
const originFile = path.join(runtimeDir, "media-origin");
const upstream = new URL(process.env.MEDIA_UPSTREAM ?? "http://127.0.0.1:3001");
const PORT = Number(process.env.MEDIA_TUNNEL_PORT ?? 3002);
const MEDIA_PATH = /^\/api\/media\/[A-Za-z0-9_-]{43}$/;
const FORWARDED = ["range", "if-range", "if-none-match", "if-modified-since", "user-agent", "accept"];

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://placeholder");
  if (!["GET", "HEAD"].includes(req.method ?? "") || !MEDIA_PATH.test(url.pathname) || url.search) {
    res.writeHead(404, { "Content-Type": "text/plain", "Cache-Control": "no-store" });
    res.end("Not found");
    return;
  }
  // Only a small allowlist of request headers is forwarded (never cookies).
  const headers = Object.fromEntries(FORWARDED.filter((name) => req.headers[name]).map((name) => [name, req.headers[name]]));
  const proxied = http.request({ host: upstream.hostname, port: upstream.port, method: req.method, path: url.pathname, headers }, (response) => {
    const out = { ...response.headers };
    delete out["set-cookie"];
    res.writeHead(response.statusCode ?? 502, out);
    response.pipe(res);
  });
  proxied.on("error", () => {
    if (!res.headersSent) res.writeHead(502, { "Content-Type": "text/plain" });
    res.end("Upstream unavailable");
  });
  proxied.end();
  const stamp = new Date().toISOString().slice(11, 19);
  console.log(`${stamp} ${req.method} /api/media/… ${req.headers.range ? `(range ${req.headers.range})` : ""}`);
});

function clearOrigin() {
  try {
    fs.rmSync(originFile, { force: true });
  } catch {}
}

clearOrigin(); // never reuse a link from an earlier run
server.listen(PORT, "127.0.0.1", () => {
  console.log(`Media-only proxy on http://127.0.0.1:${PORT} → ${upstream.origin} (only /api/media/<token>)`);
  const tunnel = spawn("cloudflared", ["tunnel", "--no-autoupdate", "--url", `http://127.0.0.1:${PORT}`], { stdio: ["ignore", "pipe", "pipe"] });
  tunnel.on("error", () => {
    console.error("cloudflared is not installed. Install it with: brew install cloudflared");
    server.close();
    process.exit(1);
  });
  const onOutput = (chunk) => {
    const match = String(chunk).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (match && !fs.existsSync(originFile)) {
      fs.mkdirSync(runtimeDir, { recursive: true, mode: 0o700 });
      fs.writeFileSync(originFile, `${match[0]}\n`, { mode: 0o600 });
      console.log(`\n  Public media link ready: ${match[0]}\n  (only video downloads are reachable; stop with Ctrl+C)\n`);
    }
  };
  tunnel.stdout.on("data", onOutput);
  tunnel.stderr.on("data", onOutput);
  const stop = () => {
    clearOrigin();
    tunnel.kill("SIGTERM");
    server.close();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  tunnel.on("exit", () => {
    clearOrigin();
    server.close();
    process.exit(0);
  });
});
