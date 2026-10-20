import { Inngest } from "inngest";
import { generateIdeas, readGeminiConfig } from "../ai/gemini";
import { generateStoryboard, reviseStoryboard } from "../ai/planner";
import { getAuthServices } from "../auth/auth";
import { localProber, localRenderer } from "../generation/render-local";
import { abandonGeneration, runGeneration } from "../generation/runner";
import { runBrainstorm } from "../jobs/brainstorm";
import { runCleanup } from "../jobs/cleanup";
import { dispatchOutbox, JOB_EVENT, PUBLISH_EVENT, type OutgoingEvent } from "../jobs/outbox";
import { refreshDueConnections } from "../instagram/service";
import { getObjectStore } from "../media/object-store";
import { advanceDueIntents, advancePublish } from "../publish/delivery";
import { elevenLabsProvider } from "../speech/elevenlabs";
import { runRevision, runStoryboard } from "../storyboards/service";

// Durable workflows (SYSTEM_DESIGN.md: Inngest coordinates steps; MongoDB state is the source of truth).
// Local development uses the Inngest Dev Server (INNGEST_DEV=1, no account); production needs signing/event keys.

export const inngest = new Inngest({ id: "namastevideo", isDev: process.env.INNGEST_DEV === "1" });

export async function sendEvents(events: OutgoingEvent[]) {
  await inngest.send(events);
}

/** Runs any content or cleanup job by ID. Ownership and inputs always come from the stored job. */
export const jobRunner = inngest.createFunction(
  {
    id: "run-job",
    triggers: [{ event: JOB_EVENT }],
    concurrency: [{ key: "event.data.jobId", limit: 1 }],
    retries: 3,
    // Out of retries: never leave a video job "running" forever; it becomes a retryable failure.
    onFailure: async ({ event }) => {
      const services = await getAuthServices();
      const jobId = String((event.data.event.data as { jobId?: string }).jobId ?? "");
      return jobId ? abandonGeneration(services, jobId) : false;
    },
  },
  async ({ event, step }) => {
    const services = await getAuthServices();
    const jobId = String((event.data as { jobId?: string }).jobId ?? "");
    const job = await step.run("load", async () => {
      const found = await services.db.collection("jobs").findOne({ _id: jobId as never }, { projection: { type: 1, state: 1 } });
      return found ? { type: String(found.type), state: String(found.state) } : null;
    });
    if (!job) return "unknown-job";
    const gemini = readGeminiConfig();
    switch (job.type) {
      case "generation":
      case "caption_render": {
        const key = process.env.ELEVENLABS_API_KEY?.trim();
        // Option A (F14): render on this machine. RENDERER=none disables rendering (jobs then fail clearly at render).
        const local = process.env.RENDERER?.trim() !== "none";
        const deps = { speech: key ? elevenLabsProvider(key) : null, store: getObjectStore(), renderer: local ? localRenderer() : null, prober: local ? localProber() : null };
        return runGeneration(services, jobId, deps, (id, run) => step.run(id, run) as never);
      }
      case "cleanup":
        return step.run("cleanup", () => runCleanup(services.db, getObjectStore(), jobId));
      case "brainstorm":
        if (!gemini) return "gemini-unavailable";
        return step.run("execute", async () => (await runBrainstorm(services, jobId, (input) => generateIdeas(gemini, input)), "done"));
      case "storyboard":
        if (!gemini) return "gemini-unavailable";
        return step.run("execute", async () => (await runStoryboard(services, jobId, (input) => generateStoryboard(gemini, input), gemini.model), "done"));
      case "revision":
        if (!gemini) return "gemini-unavailable";
        return step.run("execute", async () => (await runRevision(services, jobId, (input) => reviseStoryboard(gemini, input), gemini.model), "done"));
      default:
        return "unsupported";
    }
  },
);

/** Once a minute: dispatch committed, unsent outbox events (recovers jobs whose immediate dispatch was missed). */
export const outboxDispatcher = inngest.createFunction(
  { id: "dispatch-outbox", triggers: [{ cron: "* * * * *" }], retries: 0 },
  async ({ step }) => {
    const services = await getAuthServices();
    return step.run("dispatch", () => dispatchOutbox(services.db, sendEvents));
  },
);

/** Daily: refresh Instagram long-lived tokens that expire within the refresh window (lease + token-revision CAS). */
export const instagramTokenRefresher = inngest.createFunction(
  { id: "refresh-instagram-tokens", triggers: [{ cron: "17 3 * * *" }], retries: 0 },
  async ({ step }) => {
    const services = await getAuthServices();
    return step.run("refresh", () => refreshDueConnections(services.db));
  },
);

/**
 * Publishing: runs one intent through container → processing → publish with bounded polling (each step is a
 * claimed, persisted unit). The minute scanner below recovers anything this misses.
 */
export const publishRunner = inngest.createFunction(
  { id: "publish-intent", triggers: [{ event: PUBLISH_EVENT }], retries: 0, concurrency: { limit: 1, key: "event.data.intentId" } },
  async ({ event, step }) => {
    const services = await getAuthServices();
    const intentId = String((event.data as { intentId?: string }).intentId);
    let outcome = "skipped";
    for (let i = 0; i < 60; i++) {
      outcome = (await step.run(`advance-${i}`, () => advancePublish(services.db, intentId))) as string;
      if (outcome !== "processing") break;
      await step.sleep(`wait-${i}`, "10s");
    }
    return outcome;
  },
);

/** Every minute: due posts, processing checks, outcome reconciliation and stale claims. */
export const publishScanner = inngest.createFunction(
  { id: "scan-publish-intents", triggers: [{ cron: "* * * * *" }], retries: 0 },
  async ({ step }) => {
    const services = await getAuthServices();
    return step.run("scan", () => advanceDueIntents(services.db));
  },
);

export const functions = [jobRunner, outboxDispatcher, instagramTokenRefresher, publishRunner, publishScanner];
