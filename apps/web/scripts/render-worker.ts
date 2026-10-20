// Render worker (separate process): renders a compiled timeline with the approved prototype composition.
// Usage: node --import tsx apps/web/scripts/render-worker.ts <job.json>  (cwd: repository root)
// job.json: { entryPoint, publicDir, output, timeline }. Prints JSON lines: {progress} and finally {ok, frames}.
import fs from "node:fs/promises";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";

async function main(jobPath: string) {
  const job = JSON.parse(await fs.readFile(jobPath, "utf8")) as { entryPoint: string; publicDir: string; output: string; timeline: { frames: number } };
  const serveUrl = await bundle({ entryPoint: job.entryPoint, publicDir: job.publicDir });
  const browserExecutable = process.env.BROWSER_EXECUTABLE || undefined;
  const inputProps = { timeline: job.timeline };
  const composition = await selectComposition({ serveUrl, id: "Explainer", inputProps, browserExecutable });
  let bucket = -1;
  await renderMedia({
    serveUrl,
    composition,
    inputProps,
    browserExecutable,
    codec: "h264",
    audioCodec: "aac",
    outputLocation: job.output,
    concurrency: 2,
    crf: 23,
    onProgress: ({ progress }) => {
      const n = Math.floor(progress * 20);
      if (n !== bucket) {
        bucket = n;
        process.stdout.write(`${JSON.stringify({ progress: Math.round(progress * 100) })}\n`);
      }
    },
  });
  process.stdout.write(`${JSON.stringify({ ok: true, frames: composition.durationInFrames })}\n`);
}

main(process.argv[2]).catch((error: unknown) => {
  process.stdout.write(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message.slice(0, 500) : "render failed" })}\n`);
  process.exitCode = 1;
});
