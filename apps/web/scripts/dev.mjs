// Local development launcher: Next.js on http://127.0.0.1:3001 plus an HTTPS front door on https://localhost:3000.
// Instagram requires an HTTPS redirect URI; the Inngest dev server keeps talking plain HTTP to port 3001.
// The self-signed certificate lives in apps/web/certificates (gitignored) and is only for this machine.
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const certDir = path.join(root, "certificates");
const keyFile = path.join(certDir, "localhost-key.pem");
const certFile = path.join(certDir, "localhost.pem");
const APP_PORT = 3001;
const HTTPS_PORT = 3000;

if (!fs.existsSync(keyFile) || !fs.existsSync(certFile)) {
  fs.mkdirSync(certDir, { recursive: true, mode: 0o700 });
  execFileSync("openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-sha256", "-days", "825",
    "-keyout", keyFile, "-out", certFile, "-subj", "/CN=localhost",
    "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1",
  ], { stdio: "ignore" });
  fs.chmodSync(keyFile, 0o600);
  console.log("Created a local HTTPS certificate for localhost (apps/web/certificates).");
}

// Resolves Next's CLI whether it is installed in apps/web or hoisted to the workspace root.
const nextBin = createRequire(path.join(root, "package.json")).resolve("next/dist/bin/next");
const next = spawn(process.execPath, [nextBin, "dev", "--hostname", "127.0.0.1", "--port", String(APP_PORT)], { cwd: root, stdio: "inherit" });

const forwardHeaders = (req) => ({ ...req.headers, "x-forwarded-proto": "https", "x-forwarded-host": req.headers.host ?? `localhost:${HTTPS_PORT}` });

const server = https.createServer({ key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile) }, (req, res) => {
  const upstream = http.request({ host: "127.0.0.1", port: APP_PORT, method: req.method, path: req.url, headers: forwardHeaders(req) }, (response) => {
    res.writeHead(response.statusCode ?? 502, response.headers);
    response.pipe(res);
  });
  upstream.on("error", () => {
    if (!res.headersSent) res.writeHead(502, { "Content-Type": "text/plain" });
    res.end("The app is still starting. Reload in a moment.");
  });
  req.pipe(upstream);
});

// Hot reload uses WebSocket upgrades.
server.on("upgrade", (req, socket, head) => {
  const upstream = net.connect(APP_PORT, "127.0.0.1", () => {
    const headers = Object.entries(forwardHeaders(req)).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}`).join("\r\n");
    upstream.write(`${req.method} ${req.url} HTTP/1.1\r\n${headers}\r\n\r\n`);
    if (head.length) upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });
  upstream.on("error", () => socket.destroy());
  socket.on("error", () => upstream.destroy());
});

server.listen(HTTPS_PORT, "localhost", () => console.log(`\n  ▲ Open https://localhost:${HTTPS_PORT}  (app server on http://127.0.0.1:${APP_PORT})\n`));

const stop = () => {
  server.close();
  next.kill("SIGTERM");
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
next.on("exit", (code) => {
  server.close();
  process.exit(code ?? 0);
});
