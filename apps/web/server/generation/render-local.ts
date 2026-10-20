import { execFile, spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { Timeline } from "./compile";

// Local renderer adapter (F14, option A: render on the developer's Mac). The hosted adapter (e.g. a sandbox or
// container) can replace it behind the same `Renderer` type. Work happens in a private temporary directory —
// never in the repository's public/ or runs/ folders — and is removed afterwards.

export type RenderResult = { video: Buffer; durationMs: number; peakRssBytes: number | null };
export type Renderer = (timeline: Timeline, audio: Record<string, Buffer>, onProgress?: (percent: number) => void) => Promise<RenderResult>;
export const RENDER_TIMEOUT_MS = 15 * 60_000;

/** Repository root (the web app runs from apps/web); override with NAMASTE_REPO_ROOT. */
export function repoRoot(): string {
  return process.env.NAMASTE_REPO_ROOT?.trim() || path.resolve(process.cwd(), process.cwd().endsWith(path.join("apps", "web")) ? "../.." : ".");
}

export function localRenderer(root = repoRoot()): Renderer {
  return async (timeline, audio, onProgress) => {
    const entryPoint = path.join(root, "src", "video", "index.tsx");
    const worker = path.join(root, "apps", "web", "scripts", "render-worker.ts");
    await fs.access(entryPoint);
    const workdir = await fs.mkdtemp(path.join(os.tmpdir(), "namastevideo-render-"));
    try {
      const publicDir = path.join(workdir, "public");
      await fs.mkdir(path.join(publicDir, "audio"), { recursive: true });
      const scenes = await Promise.all(
        timeline.scenes.map(async (scene) => {
          const bytes = audio[scene.id];
          if (!bytes) throw new Error(`Missing audio for scene ${scene.id}`);
          await fs.writeFile(path.join(publicDir, "audio", `${scene.id}.mp3`), bytes);
          return { ...scene, audioFile: `audio/${scene.id}.mp3` };
        }),
      );
      const output = path.join(workdir, "output.mp4");
      const jobPath = path.join(workdir, "job.json");
      await fs.writeFile(jobPath, JSON.stringify({ entryPoint, publicDir, output, timeline: { ...timeline, scenes } }));

      const started = Date.now();
      const timeBinary = "/usr/bin/time";
      const useTime = await fs.access(timeBinary).then(() => true, () => false);
      const args = [process.execPath, "--import", "tsx", worker, jobPath];
      const child = spawn(useTime ? timeBinary : args[0], useTime ? ["-l", ...args] : args.slice(1), { cwd: root, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
      let stderr = "";
      let last: { ok?: boolean; error?: string } = {};
      child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
        for (const line of chunk.split("\n").filter(Boolean)) {
          try {
            const message = JSON.parse(line);
            if (typeof message.progress === "number") onProgress?.(message.progress);
            if ("ok" in message) last = message;
          } catch {
            // ignore non-JSON output from tools
          }
        }
      });
      child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
        stderr = (stderr + chunk).slice(-20_000);
      });
      const code = await new Promise<number | null>((resolve, reject) => {
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          reject(new Error("Rendering exceeded the 15-minute limit"));
        }, RENDER_TIMEOUT_MS);
        child.on("error", reject);
        child.on("exit", (exitCode) => {
          clearTimeout(timer);
          resolve(exitCode);
        });
      });
      if (code !== 0 || !last.ok) throw new Error(last.error ?? `Renderer exited with code ${code}`);
      const rss = /(\d+)\s+maximum resident set size/.exec(stderr);
      return { video: await fs.readFile(output), durationMs: Date.now() - started, peakRssBytes: rss ? Number(rss[1]) : null };
    } finally {
      await fs.rm(workdir, { recursive: true, force: true });
    }
  };
}

export type ProbeResult = { format: { duration: string }; streams: { codec_type: string; codec_name: string; width?: number; height?: number; avg_frame_rate?: string }[] };
export type Prober = (video: Buffer) => Promise<ProbeResult>;

/** ffprobe from Remotion's platform compositor package (already installed for the prototype). */
export function localProber(root = repoRoot()): Prober {
  return async (video) => {
    const require = createRequire(path.join(root, "package.json"));
    const ffprobe = path.join(path.dirname(require.resolve(`@remotion/compositor-${process.platform}-${process.arch}/package.json`)), "ffprobe");
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "namastevideo-probe-"));
    try {
      const file = path.join(dir, "video.mp4");
      await fs.writeFile(file, video);
      const { stdout } = await promisify(execFile)(ffprobe, ["-v", "error", "-show_streams", "-show_format", "-of", "json", file], { cwd: path.dirname(ffprobe) });
      return JSON.parse(stdout) as ProbeResult;
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  };
}
