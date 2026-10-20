// F13: G01/G03/G04, durable stage execution with leases/fences, speech caching, cancellation, unknown outcomes,
// outbox dispatch and project cleanup. Speech uses a fake provider; storage uses the in-memory object store.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import realPlan from "./fixtures/plan-dns.json";
import { ProviderError } from "../server/ai/gemini";
import { commandIdentity } from "../server/commands";
import { acceptGeneration, cancelJob, retryJob } from "../server/generation/service";
import { abandonGeneration, claimStage, runGeneration } from "../server/generation/runner";
import { providerText } from "../server/generation/spec";
import { runCleanup } from "../server/jobs/cleanup";
import { dispatchOutbox, type OutgoingEvent } from "../server/jobs/outbox";
import { MemoryObjectStore, setObjectStoreForTests } from "../server/media/object-store";
import { getJob } from "../server/projects/service";
import type { Speech, SpeechProvider } from "../server/speech/elevenlabs";
import { acceptStoryboard, runStoryboard, storyboardContentHash } from "../server/storyboards/service";
import type { PlanV2 } from "../lib/plan";
import { json, params, startHarness, type Harness } from "./harness";

let h: Harness;
const store = new MemoryObjectStore();
let routes: { projects: typeof import("../app/api/projects/route"); project: typeof import("../app/api/projects/[id]/route"); draft: typeof import("../app/api/projects/[id]/draft/route"); apply: typeof import("../app/api/projects/[id]/draft/apply/route") };
const plan = realPlan as PlanV2;
const direct = <T>(_id: string, run: () => Promise<T>) => run();

before(async () => {
  setObjectStoreForTests(store);
  h = await startHarness("f13", ["a", "b"]);
  routes = {
    projects: await import("../app/api/projects/route"),
    project: await import("../app/api/projects/[id]/route"),
    draft: await import("../app/api/projects/[id]/draft/route"),
    apply: await import("../app/api/projects/[id]/draft/apply/route"),
  };
});
after(async () => {
  setObjectStoreForTests(undefined);
  await h?.stop();
});

const identity = (path: string, body: unknown, user = "a", key: string = randomUUID()) =>
  commandIdentity(new Request("http://x", { method: "POST", headers: { "idempotency-key": key } }), h.users[user].id, path, body);

function fakeSpeech(options: { failOn?: string; error?: ProviderError; onCall?: (text: string) => Promise<void>; secondsPerChar?: number } = {}) {
  const calls: string[] = [];
  const provider: SpeechProvider = async (text) => {
    calls.push(text);
    await options.onCall?.(text);
    if (options.failOn && text.includes(options.failOn)) throw options.error ?? new ProviderError("PROVIDER_REJECTED", false, "rejected");
    const characters = [...text];
    const step = options.secondsPerChar ?? 0.07; // ~65 s for the fixture: inside the 60–90 s gate
    const speech: Speech = {
      audio: Buffer.concat([Buffer.from("ID3"), Buffer.alloc(1500, characters.length % 255)]),
      alignment: { characters, character_start_times_seconds: characters.map((_, i) => i * step), character_end_times_seconds: characters.map((_, i) => (i + 1) * step) },
      durationSeconds: characters.length * step,
    };
    return speech;
  };
  return { provider, calls };
}

/** A project with an applied, valid storyboard ready to approve (returns the saved draft precondition). */
async function readyProject(user = "a") {
  const project = (await json(await routes.projects.POST(h.request("POST", "/api/projects", { user, body: {}, key: randomUUID() })))).body.data;
  await routes.draft.PATCH(h.request("PATCH", `/api/projects/${project.id}/draft`, { user, body: { expectedRevision: 1, changes: { topic: "How DNS works" } } }), params(project.id));
  const sbBody = { expectedDraftRevision: 2 };
  const { jobId } = await acceptStoryboard(h.services, identity(`/api/projects/${project.id}/storyboards`, sbBody, user), project.id, sbBody);
  await runStoryboard(h.services, jobId, async () => ({ plan, warnings: [], attempts: 1 }), "test");
  const storyboard = await h.db.collection("storyboards").findOne({ projectId: project.id });
  const applied = await json(await routes.apply.POST(
    h.request("POST", `/api/projects/${project.id}/draft/apply`, { user, key: randomUUID(), body: { expectedDraftRevision: 2, storyboardId: String(storyboard?._id), expectedContentHash: storyboardContentHash(plan) } }),
    params(project.id),
  ));
  return { projectId: project.id as string, revision: applied.body.data.revision as number, contentHash: applied.body.data.contentHash as string };
}

async function start(user = "a") {
  const ready = await readyProject(user);
  const body = { expectedDraftRevision: ready.revision, expectedContentHash: ready.contentHash, approve: true as const };
  const { operation } = await acceptGeneration(h.services, identity(`/api/projects/${ready.projectId}/generations`, body, user), ready.projectId, body);
  return { ...ready, jobId: operation.jobId, videoId: operation.resource!.id };
}
const job = (id: string) => h.db.collection("jobs").findOne({ _id: id as never });

test("G01 approves the exact draft and atomically creates the video, frozen job inputs, slot, outbox and receipt", async () => {
  const ready = await readyProject();
  const body = { expectedDraftRevision: ready.revision, expectedContentHash: ready.contentHash, approve: true as const };
  const key = randomUUID();
  const { operation, replayed } = await acceptGeneration(h.services, identity(`/api/projects/${ready.projectId}/generations`, body, "a", key), ready.projectId, body);
  assert.equal(replayed, false);
  assert.deepEqual([operation.state, operation.resource?.kind, operation.statusUrl], ["queued", "video", `/api/jobs/${operation.jobId}`]);

  const video = await h.db.collection("videos").findOne({ _id: operation.resource!.id as never });
  assert.deepEqual([video?.state, video?.resolvedVoice.preset, video?.resolvedVoice.provider, video?.renderSpec.storyHash.length], ["building", "daniel-test", "elevenlabs", 64]);
  const approval = await h.db.collection("approvals").findOne({ _id: video?.storyApprovalId });
  assert.equal(approval?.subjectId, video?.storyboardId);
  const j = await job(operation.jobId);
  assert.deepEqual([j?.type, j?.state, j?.activeSlot, j?.inputSnapshot.renderSpecHash, j?.inputSnapshot.scenes.length], ["generation", "queued", true, video?.renderSpecHash, plan.scenes.length]);
  assert.equal(j?.inputSnapshot.scenes[0].text, providerText(plan.scenes[0]), "pronunciation substitutions are applied to provider text");
  assert.notEqual(j?.inputSnapshot.scenes[0].text, plan.scenes[0].narration);
  assert.equal((await h.db.collection("projects").findOne({ _id: ready.projectId as never }))?.activeJobId, operation.jobId);
  assert.equal(await h.db.collection("outbox").countDocuments({ aggregateId: operation.jobId, eventType: "job.generation.requested" }), 1);

  const replay = await acceptGeneration(h.services, identity(`/api/projects/${ready.projectId}/generations`, body, "a", key), ready.projectId, body);
  assert.deepEqual([replay.replayed, replay.operation.jobId], [true, operation.jobId]);
  await assert.rejects(acceptGeneration(h.services, identity(`/api/projects/${ready.projectId}/generations`, body), ready.projectId, body), (e: { code?: string }) => e.code === "PROJECT_BUSY");
});

test("G01 rejects changed or invalid drafts without creating a video or job", async () => {
  const ready = await readyProject();
  const body = { expectedDraftRevision: ready.revision, expectedContentHash: "0".repeat(64), approve: true as const };
  await assert.rejects(acceptGeneration(h.services, identity(`/api/projects/${ready.projectId}/generations`, body), ready.projectId, body), (e: { code?: string }) => e.code === "HASH_MISMATCH");
  assert.equal(await h.db.collection("videos").countDocuments({ projectId: ready.projectId }), 0);
  assert.equal(await h.db.collection("jobs").countDocuments({ projectId: ready.projectId, type: "generation" }), 0);
  const other = await readyProject("b");
  const foreign = { expectedDraftRevision: other.revision, expectedContentHash: other.contentHash, approve: true as const };
  await assert.rejects(acceptGeneration(h.services, identity(`/api/projects/${other.projectId}/generations`, foreign, "a"), other.projectId, foreign), (e: { code?: string }) => e.code === "NOT_FOUND");
});

test("a run records narration once per scene, compiles a timeline, and fails clearly when no renderer is configured", async () => {
  const s = await start();
  const speech = fakeSpeech();
  const [first, second] = await Promise.all([runGeneration(h.services, s.jobId, { speech: speech.provider, store }, direct), runGeneration(h.services, s.jobId, { speech: speech.provider, store }, direct)]);
  assert.deepEqual([first, second].sort(), ["failed", "not-claimed"], "a duplicate delivery is a no-op");
  assert.equal(speech.calls.length, plan.scenes.length);

  const j = await job(s.jobId);
  assert.deepEqual([j?.state, j?.error.code, j?.error.retryable, j?.progress.completedScenes, j?.activeSlot], ["failed", "INTEGRATION_UNAVAILABLE", true, plan.scenes.length, undefined]);
  assert.equal((await h.db.collection("jobStages").findOne({ jobId: s.jobId, stageKey: "compile" }))?.state, "succeeded");
  assert.equal(await h.db.collection("assets").countDocuments({ projectId: s.projectId, kind: "timeline", state: "ready" }), 1);
  assert.equal((await h.db.collection("videos").findOne({ _id: s.videoId as never }))?.state, "failed");
  assert.equal((await h.db.collection("projects").findOne({ _id: s.projectId as never }))?.activeJobId, undefined);
  const assets = await h.db.collection("assets").find({ projectId: s.projectId, state: "ready" }).toArray();
  assert.equal(assets.filter((a) => a.kind === "audio").length, plan.scenes.length);
  assert.equal(assets.filter((a) => a.kind === "alignment").length, plan.scenes.length);
  const stages = await h.db.collection("jobStages").find({ jobId: s.jobId }).toArray();
  assert.equal(stages.filter((x) => x.stageKey.startsWith("speech:") && x.state === "succeeded").length, plan.scenes.length);
  assert.equal(stages.find((x) => x.stageKey === "render")?.state, "failed");
  const view = await getJob(h.db, h.users.a.id, s.jobId);
  assert.deepEqual(view?.actions, { cancel: false, retry: true, regenerate: false });
});

test("retry reuses completed narration without new provider calls and requires the current revision", async () => {
  const s = await start();
  await runGeneration(h.services, s.jobId, { speech: fakeSpeech().provider, store }, direct);
  const failed = await job(s.jobId);
  await assert.rejects(retryJob(h.services, identity(`/api/jobs/${s.jobId}/retry`, {}), s.jobId, { expectedRevision: failed!.revision - 1 }), (e: { code?: string }) => e.code === "REVISION_CONFLICT");
  const { operation } = await retryJob(h.services, identity(`/api/jobs/${s.jobId}/retry`, {}), s.jobId, { expectedRevision: failed!.revision });
  const queued = await job(s.jobId);
  assert.deepEqual([operation.jobId, queued?.state, queued?.executionAttempt, queued?.activeSlot], [s.jobId, "queued", 2, true]);
  assert.equal((await h.db.collection("videos").findOne({ _id: s.videoId as never }))?.state, "building");

  const again = fakeSpeech();
  assert.equal(await runGeneration(h.services, s.jobId, { speech: again.provider, store }, direct), "failed");
  assert.equal(again.calls.length, 0, "completed speech stages are reused");
  const running = await start();
  await assert.rejects(retryJob(h.services, identity(`/api/jobs/${running.jobId}/retry`, {}), running.jobId, { expectedRevision: 1 }), (e: { code?: string }) => e.code === "JOB_NOT_RETRYABLE");
});

test("cancellation: queued jobs stop immediately; running jobs stop at the next stage boundary", async () => {
  const queued = await start();
  await cancelJob(h.services, identity(`/api/jobs/${queued.jobId}/cancel`, {}), queued.jobId, { expectedRevision: 1 });
  assert.deepEqual([(await job(queued.jobId))?.state, (await h.db.collection("projects").findOne({ _id: queued.projectId as never }))?.activeJobId], ["cancelled", undefined]);
  assert.equal(await runGeneration(h.services, queued.jobId, { speech: fakeSpeech().provider, store }, direct), "not-claimed");

  const running = await start();
  let cancelled = false;
  const speech = fakeSpeech({
    onCall: async () => {
      if (cancelled) return;
      cancelled = true;
      const current = await job(running.jobId);
      await cancelJob(h.services, identity(`/api/jobs/${running.jobId}/cancel`, {}), running.jobId, { expectedRevision: current!.revision });
    },
  });
  assert.equal(await runGeneration(h.services, running.jobId, { speech: speech.provider, store }, direct), "cancelled");
  assert.equal(speech.calls.length, 1, "no further scenes after cancellation");
  assert.equal((await job(running.jobId))?.state, "cancelled");
  await assert.rejects(cancelJob(h.services, identity(`/api/jobs/${running.jobId}/cancel`, {}), running.jobId, { expectedRevision: (await job(running.jobId))!.revision }), (e: { code?: string }) => e.code === "JOB_TERMINAL");
});

test("an unknown provider outcome is never repeated automatically; retry needs explicit acknowledgement", async () => {
  const s = await start();
  const firstText = providerText(plan.scenes[0]).slice(0, 20);
  const speech = fakeSpeech({ failOn: firstText, error: new ProviderError("PROVIDER_OUTCOME_UNKNOWN", true, "timeout") });
  assert.equal(await runGeneration(h.services, s.jobId, { speech: speech.provider, store }, direct), "failed");
  const failed = await job(s.jobId);
  assert.equal(failed?.error.code, "PROVIDER_OUTCOME_UNKNOWN");
  assert.equal((await h.db.collection("jobStages").findOne({ jobId: s.jobId, stageKey: `speech:${plan.scenes[0].id}` }))?.state, "outcome_unknown");
  await assert.rejects(retryJob(h.services, identity(`/api/jobs/${s.jobId}/retry`, {}), s.jobId, { expectedRevision: failed!.revision }), (e: { code?: string }) => e.code === "REPEAT_ACK_REQUIRED");
  await retryJob(h.services, identity(`/api/jobs/${s.jobId}/retry`, {}), s.jobId, { expectedRevision: failed!.revision, acknowledgePossibleProviderRepeat: true });
  const second = fakeSpeech();
  await runGeneration(h.services, s.jobId, { speech: second.provider, store }, direct);
  assert.equal(second.calls.length, plan.scenes.length);
});

test("a crash after the provider request started becomes outcome_unknown instead of a silent repeat", async () => {
  const s = await start();
  const j = await job(s.jobId);
  const stageJob = { _id: s.jobId, ownerId: j!.ownerId, projectId: j!.projectId, executionAttempt: 1, inputSnapshot: j!.inputSnapshot };
  const claim = await claimStage(h.services, stageJob, "speech:test", "a".repeat(64));
  assert.equal(claim.status, "claimed");
  await h.db.collection("jobStages").updateOne({ jobId: s.jobId, stageKey: "speech:test" }, { $set: { state: "request_started", "lease.until": new Date(Date.now() - 1000) } });
  assert.equal((await claimStage(h.services, stageJob, "speech:test", "a".repeat(64))).status, "unknown");
  await h.db.collection("jobStages").updateOne({ jobId: s.jobId, stageKey: "speech:test" }, { $set: { state: "leased", "lease.until": new Date(Date.now() + 60_000) } });
  await assert.rejects(claimStage(h.services, stageJob, "speech:test", "a".repeat(64)), /held by another execution/);
});

test("the outbox dispatches each event once with a stable ID and backs off when the runner is unreachable", async () => {
  const s = await start();
  // Isolate this job's event: everything else is marked delivered.
  await h.db.collection("outbox").updateMany({ aggregateId: { $ne: s.jobId }, state: { $ne: "sent" } }, { $set: { state: "sent", sentAt: new Date() }, $unset: { lease: "" } });
  const failing = await dispatchOutbox(h.db, async () => { throw new Error("down"); });
  assert.deepEqual(failing, { sent: 0, failed: 1 });
  const record = await h.db.collection("outbox").findOne({ aggregateId: s.jobId });
  assert.deepEqual([record?.state, record?.attempts, record?.availableAt > new Date()], ["pending", 1, true]);
  await h.db.collection("outbox").updateOne({ _id: record!._id }, { $set: { availableAt: new Date(0) } });
  const sent: OutgoingEvent[] = [];
  assert.deepEqual(await dispatchOutbox(h.db, async (events) => { sent.push(...events); }), { sent: 1, failed: 0 });
  assert.deepEqual(sent, [{ id: String(record?.eventId), name: "namastevideo/job.requested", data: { jobId: s.jobId } }] as OutgoingEvent[]);
  assert.deepEqual(await dispatchOutbox(h.db, async (events) => { sent.push(...events); }), { sent: 0, failed: 0 });
});

test("project cleanup deletes stored objects and project content but keeps the owner-readable cleanup status", async () => {
  const s = await start();
  await runGeneration(h.services, s.jobId, { speech: fakeSpeech().provider, store }, direct);
  const keys = (await h.db.collection("assets").find({ projectId: s.projectId }).toArray()).map((a) => a.objectKey);
  assert.ok(keys.length > 0 && keys.every((k) => store.objects.has(k)));
  const project = await h.db.collection("projects").findOne({ _id: s.projectId as never });
  const deleted = await json(await routes.project.DELETE(h.request("DELETE", `/api/projects/${s.projectId}`, { body: { expectedRevision: project!.revision, confirm: true }, key: randomUUID() }), params(s.projectId)));
  const cleanupJobId = deleted.body.data.jobId;
  assert.equal(await runCleanup(h.db, store, cleanupJobId), "cleaned");
  assert.ok(keys.every((k) => !store.objects.has(k)), "R2 objects deleted");
  for (const name of ["drafts", "storyboards", "videos", "messages", "jobStages"]) assert.equal(await h.db.collection(name).countDocuments({ projectId: s.projectId }), 0, name);
  const status = await getJob(h.db, h.users.a.id, cleanupJobId);
  assert.deepEqual([status?.state, status?.result], ["succeeded", { kind: "cleanup", externalOutcomePending: false }]);
  assert.equal(await runCleanup(h.db, store, cleanupJobId), "not-claimed");
});

// ---- F14: compile → render → validate → finalize ----------------------------------------------------------------

import { qualityChecks } from "../server/generation/runner";
import type { Prober, Renderer } from "../server/generation/render-local";

const goodProbe = (seconds: number) => ({ format: { duration: String(seconds) }, streams: [{ codec_type: "video", codec_name: "h264", width: 1080, height: 1920, avg_frame_rate: "30/1" }, { codec_type: "audio", codec_name: "aac" }] });
function fakeRenderer(onRender?: () => Promise<void>) {
  const renders: { frames: number; scenes: number; audioScenes: number }[] = [];
  const renderer: Renderer = async (timeline, audio) => {
    renders.push({ frames: timeline.frames, scenes: timeline.scenes.length, audioScenes: Object.keys(audio).length });
    await onRender?.();
    return { video: Buffer.from(`mp4-${timeline.frames}-${Math.random()}`), durationMs: 1234, peakRssBytes: 1_000_000 };
  };
  return { renderer, renders };
}
const prober = (probe?: (frames: number) => ReturnType<typeof goodProbe>): Prober => async (video) => {
  const frames = Number(String(video).split("-")[1]);
  return (probe ?? ((f: number) => goodProbe(f / 30)))(frames);
};

test("a full run produces a validated ready video, updates the latest-ready pointer and keeps earlier versions", async () => {
  const s = await start();
  const render = fakeRenderer();
  assert.equal(await runGeneration(h.services, s.jobId, { speech: fakeSpeech().provider, store, renderer: render.renderer, prober: prober() }, direct), "ready");
  assert.deepEqual(render.renders.map((r) => [r.scenes, r.audioScenes]), [[plan.scenes.length, plan.scenes.length]]);
  const video = await h.db.collection("videos").findOne({ _id: s.videoId as never });
  assert.deepEqual([video?.state, video?.qa.passed, typeof video?.outputHash, typeof video?.timelineAssetId], ["ready_for_review", true, "string", "string"]);
  const output = await h.db.collection("assets").findOne({ _id: video?.outputAssetId });
  assert.deepEqual([output?.kind, output?.contentType, output?.state, output?.sha256], ["video", "video/mp4", "ready", video?.outputHash]);
  const project = await h.db.collection("projects").findOne({ _id: s.projectId as never });
  assert.deepEqual([project?.latestReadyVideoId, project?.flags.ready, project?.activeJobId], [s.videoId, true, undefined]);
  const j = await getJob(h.db, h.users.a.id, s.jobId);
  assert.deepEqual([j?.state, j?.result], ["succeeded", { kind: "video", videoId: s.videoId }]);
  assert.equal(await h.db.collection("diagnosticEvents").countDocuments({ operationId: s.jobId, eventType: "render.completed" }), 1);

  // Generating again creates a new video; the earlier ready video stays as it was.
  const draft = (await json(await routes.draft.GET(h.request("GET", `/api/projects/${s.projectId}/draft`), params(s.projectId)))).body.data;
  const body = { expectedDraftRevision: draft.revision, expectedContentHash: draft.contentHash, approve: true as const };
  const second = await acceptGeneration(h.services, identity(`/api/projects/${s.projectId}/generations`, body), s.projectId, body);
  const speech = fakeSpeech();
  await runGeneration(h.services, second.operation.jobId, { speech: speech.provider, store, renderer: fakeRenderer().renderer, prober: prober() }, direct);
  assert.equal(speech.calls.length, 0, "narration is reused across videos with identical text and voice");
  assert.equal((await h.db.collection("videos").findOne({ _id: s.videoId as never }))?.state, "ready_for_review");
  assert.equal((await h.db.collection("projects").findOne({ _id: s.projectId as never }))?.latestReadyVideoId, second.operation.resource!.id);
});

test("durable workflow steps that memoize results as JSON still finalize after a retried finalize step", async () => {
  // Inngest memoizes each completed step's result as JSON (dates become strings) and retries only the failed step.
  const memo = new Map<string, string>();
  let crashFinalize = true;
  const inngestLike = async <T>(id: string, run: () => Promise<T>): Promise<T> => {
    if (memo.has(id)) return JSON.parse(memo.get(id)!) as T;
    if (id.includes("finalize") && crashFinalize) {
      crashFinalize = false;
      throw new Error("worker crashed");
    }
    const value = await run();
    memo.set(id, JSON.stringify(value ?? null));
    return JSON.parse(memo.get(id)!) as T;
  };
  const s = await start();
  const render = fakeRenderer();
  const deps = { speech: fakeSpeech().provider, store, renderer: render.renderer, prober: prober() };
  await assert.rejects(runGeneration(h.services, s.jobId, deps, inngestLike));
  assert.equal((await h.db.collection("videos").findOne({ _id: s.videoId as never }))?.state, "building");
  assert.equal(await runGeneration(h.services, s.jobId, deps, inngestLike), "ready", "the retry replays memoized steps and finalizes");
  assert.equal(render.renders.length, 1);
  const video = await h.db.collection("videos").findOne({ _id: s.videoId as never });
  assert.deepEqual([video?.state, video?.qa.passed, video?.qa.checkedAt instanceof Date], ["ready_for_review", true, true]);
});

test("a finished render is reused when the job runs again, re-checking QA from the stored file", async () => {
  const s = await start();
  const render = fakeRenderer();
  const deps = { speech: fakeSpeech().provider, store, renderer: render.renderer, prober: prober() };
  const crashAtFinalize = <T>(id: string, run: () => Promise<T>) => (id.includes("finalize") ? Promise.reject(new Error("worker crashed")) : run());
  await assert.rejects(runGeneration(h.services, s.jobId, deps, crashAtFinalize));
  // The workflow gives up: the job becomes a retryable failure instead of hanging.
  assert.equal(await abandonGeneration(h.services, s.jobId), true);
  const failed = await getJob(h.db, h.users.a.id, s.jobId);
  assert.deepEqual([failed?.state, failed?.error?.code, failed?.actions.retry], ["failed", "WORKER_FAILED", true]);
  assert.equal(await abandonGeneration(h.services, s.jobId), false, "only running jobs are abandoned");
  // Retry re-queues; completed narration and the stored render are reused (QA re-checked from the file).
  await retryJob(h.services, identity(`/api/jobs/${s.jobId}/retry`, {}), s.jobId, { expectedRevision: failed!.revision });
  assert.equal(await runGeneration(h.services, s.jobId, deps, direct), "ready");
  assert.equal(render.renders.length, 1, "no second render");
});

test("failed output checks never produce a ready video", async () => {
  const s = await start();
  const wrongSize = prober((f) => ({ ...goodProbe(f / 30), streams: [{ codec_type: "video", codec_name: "h264", width: 720, height: 1280, avg_frame_rate: "30/1" }] }));
  assert.equal(await runGeneration(h.services, s.jobId, { speech: fakeSpeech().provider, store, renderer: fakeRenderer().renderer, prober: wrongSize }, direct), "failed");
  const j = await job(s.jobId);
  assert.equal(j?.error.code, "OUTPUT_INVALID");
  assert.match(j?.error.message, /dimensions/);
  assert.match(j?.error.message, /audio/);
  assert.equal((await h.db.collection("videos").findOne({ _id: s.videoId as never }))?.state, "failed");
  assert.equal(await h.db.collection("assets").countDocuments({ projectId: s.projectId, kind: "video" }), 0);
});

test("a render that finishes after cancellation never becomes the ready output", async () => {
  const s = await start();
  const render = fakeRenderer(async () => {
    const current = await job(s.jobId);
    await cancelJob(h.services, identity(`/api/jobs/${s.jobId}/cancel`, {}), s.jobId, { expectedRevision: current!.revision });
  });
  assert.equal(await runGeneration(h.services, s.jobId, { speech: fakeSpeech().provider, store, renderer: render.renderer, prober: prober() }, direct), "cancelled");
  assert.equal((await job(s.jobId))?.state, "cancelled");
  assert.notEqual((await h.db.collection("videos").findOne({ _id: s.videoId as never }))?.state, "ready_for_review");
  assert.equal((await h.db.collection("projects").findOne({ _id: s.projectId as never }))?.latestReadyVideoId, undefined);
});

test("narration outside 60–90 s stops before rendering and asks for a revised storyboard", async () => {
  const s = await start();
  const render = fakeRenderer();
  assert.equal(await runGeneration(h.services, s.jobId, { speech: fakeSpeech({ secondsPerChar: 0.03 }).provider, store, renderer: render.renderer, prober: prober() }, direct), "failed");
  const j = await job(s.jobId);
  assert.deepEqual([j?.error.code, j?.error.retryable], ["DURATION_OUT_OF_RANGE", false]);
  assert.equal(render.renders.length, 0);
});

test("quality checks require exact format, matching duration and bounded captions", () => {
  const timeline = { title: "t", fixture: false, fps: 30, frames: 2100, scenes: [{ frames: 2100, captions: [{ text: "ok", start: 0, end: 30 }] }] } as never;
  assert.equal(qualityChecks(goodProbe(70), timeline).passed, true);
  assert.equal(qualityChecks(goodProbe(75), timeline).checks.duration, false, "duration must match the timeline");
  assert.equal(qualityChecks({ ...goodProbe(70), streams: [goodProbe(70).streams[0]] }, timeline).checks.audio, false);
});
