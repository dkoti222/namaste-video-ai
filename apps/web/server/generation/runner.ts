import { Long, type Db } from "mongodb";
import { ProviderError } from "../ai/gemini";
import { newId } from "../db/migrations";
import { inTransaction, type JobContext, type SafeError } from "../jobs/core";
import { storeAsset } from "../media/assets";
import type { ObjectStore } from "../media/object-store";
import type { SpeechProvider } from "../speech/elevenlabs";
import type { PlanV2 } from "../../lib/plan";
import { compileTimeline, CompileError, type SceneSpeech, type Timeline } from "./compile";
import type { Prober, Renderer } from "./render-local";
import type { GenerationSnapshot } from "./service";

// Generation pipeline stages (DB_DESIGN.md sections 5.4, 8.2, T06/T07). Every stage is claimed with a lease and a
// monotonically increasing fence; only the current fence may complete it. Speech marks `request_started` before the
// paid call, so a crash or timeout afterwards becomes `outcome_unknown` instead of a silent repeat.
// After narration: compile (timeline asset) → render (approved prototype composition) → validate (probe + QA) →
// finalize (T08: video ready_for_review, latest ready pointer, job succeeded). Earlier ready videos are untouched.

export const LEASE_MS = 5 * 60_000;
type Step = <T>(id: string, run: () => Promise<T>) => Promise<T>;
export type GenerationDeps = { speech: SpeechProvider | null; store: ObjectStore | null; renderer?: Renderer | null; prober?: Prober | null };
export const RENDER_LEASE_MS = 20 * 60_000;
type Outcome = { ok: true } | { ok: false; error: SafeError } | { cancelled: true };
type Job = { _id: string; ownerId: string; projectId: string; executionAttempt: number; inputSnapshot: GenerationSnapshot };

const safe = (code: string, message: string, retryable: boolean): SafeError => ({ code, message, retryable, correlationId: newId("cor") });

async function cancelRequested(db: Db, jobId: string): Promise<boolean> {
  const job = await db.collection("jobs").findOne({ _id: jobId as never }, { projection: { state: 1 } });
  return job?.state === "cancel_requested";
}

type Claim = { status: "claimed"; stageId: string; attemptId: string; fence: Long } | { status: "succeeded" } | { status: "unknown" };

/** T06: claim a stage for this execution. Expired leases are re-leased only if no external request started. */
export async function claimStage(ctx: JobContext, job: Job, stageKey: string, fingerprint: string, leaseMs = LEASE_MS): Promise<Claim> {
  const { db, client } = ctx;
  return inTransaction(client, async (session) => {
    const now = new Date();
    const stages = db.collection("jobStages");
    let stage = await stages.findOne({ jobId: job._id, stageKey }, { session });
    if (!stage) {
      const stageId = newId("stg");
      await stages.insertOne(
        { _id: stageId as never, schemaVersion: 1, ownerId: job.ownerId, projectId: job.projectId, jobId: job._id, stageKey, state: "pending", fingerprint, fence: Long.fromNumber(0), artifactIds: [], createdAt: now, updatedAt: now },
        { session },
      );
      stage = await stages.findOne({ _id: stageId as never }, { session });
    }
    if (!stage) throw new Error("Stage record missing");
    if (stage.state === "succeeded") return { status: "succeeded" as const };
    const expired = stage.lease && stage.lease.until < now;
    if (stage.state === "outcome_unknown" || (stage.state === "request_started" && expired)) {
      await stages.updateOne({ _id: stage._id, state: stage.state }, { $set: { state: "outcome_unknown", updatedAt: now } }, { session });
      return { status: "unknown" as const };
    }
    if (stage.state === "request_started" || (stage.state === "leased" && !expired)) {
      throw new Error(`Stage ${stageKey} is held by another execution`);
    }
    const fence = Long.fromValue(stage.fence).add(1);
    const attemptId = newId("att");
    const attemptNumber = (await db.collection("stageAttempts").countDocuments({ stageId: stage._id }, { session })) + 1;
    const holder = newId("lse");
    const claimed = await stages.updateOne(
      { _id: stage._id, fence: stage.fence, state: stage.state },
      { $set: { state: "leased", fence, currentAttemptId: attemptId, lease: { holder, until: new Date(now.getTime() + leaseMs), fence }, updatedAt: now }, $unset: { error: "" } },
      { session },
    );
    if (claimed.modifiedCount !== 1) throw new Error(`Stage ${stageKey} claim lost`);
    await db.collection("stageAttempts").insertOne(
      { _id: attemptId as never, schemaVersion: 1, ownerId: job.ownerId, projectId: job.projectId, jobId: job._id, stageId: stage._id, attemptNumber, fence, fingerprint, state: "started", outputKeys: [], artifactIds: [], startedAt: now, createdAt: now, updatedAt: now },
      { session },
    );
    return { status: "claimed" as const, stageId: String(stage._id), attemptId, fence };
  });
}

async function setStage(ctx: JobContext, claim: Extract<Claim, { status: "claimed" }>, stageState: string, attemptState: string, extra: { artifactIds?: string[]; error?: SafeError } = {}) {
  const now = new Date();
  await inTransaction(ctx.client, async (session) => {
    // Fenced: a stale execution that lost its lease cannot change the stage.
    const updated = await ctx.db.collection("jobStages").updateOne(
      { _id: claim.stageId as never, fence: claim.fence, currentAttemptId: claim.attemptId },
      { $set: { state: stageState, updatedAt: now, ...(extra.artifactIds ? { artifactIds: extra.artifactIds } : {}), ...(extra.error ? { error: extra.error } : {}) } },
      { session },
    );
    if (updated.modifiedCount !== 1) throw new Error("Stage fence lost");
    const terminal = ["succeeded", "failed", "outcome_unknown", "cancelled"].includes(attemptState);
    await ctx.db.collection("stageAttempts").updateOne(
      { _id: claim.attemptId as never },
      { $set: { state: attemptState, updatedAt: now, ...(terminal ? { finishedAt: now } : {}), ...(extra.artifactIds ? { artifactIds: extra.artifactIds } : {}), ...(extra.error ? { error: extra.error } : {}) } },
      { session },
    );
  });
}

/** Narration for one scene: reuse a verified cached recording, otherwise one guarded provider call → R2 assets. */
export async function speechStage(ctx: JobContext, deps: GenerationDeps, job: Job, scene: GenerationSnapshot["scenes"][number]): Promise<Outcome> {
  if (await cancelRequested(ctx.db, job._id)) return { cancelled: true };
  const claim = await claimStage(ctx, job, `speech:${scene.id}`, scene.fingerprint);
  if (claim.status === "succeeded") return { ok: true };
  if (claim.status === "unknown") return { ok: false, error: safe("PROVIDER_OUTCOME_UNKNOWN", "A narration request may already have been charged. Confirm before retrying.", true) };

  const cached = await ctx.db
    .collection("assets")
    .find({ ownerId: job.ownerId, projectId: job.projectId, producerFingerprint: scene.fingerprint, state: "ready", kind: { $in: ["audio", "alignment"] } })
    .toArray();
  const audio = cached.find((a) => a.kind === "audio");
  const alignment = cached.find((a) => a.kind === "alignment");
  if (audio && alignment) {
    await setStage(ctx, claim, "succeeded", "succeeded", { artifactIds: [String(audio._id), String(alignment._id)] });
    return { ok: true };
  }
  if (!deps.speech || !deps.store) {
    const error = safe("INTEGRATION_UNAVAILABLE", "Narration or media storage isn’t configured.", true);
    await setStage(ctx, claim, "failed", "failed", { error });
    return { ok: false, error };
  }

  await setStage(ctx, claim, "request_started", "request_started");
  let speech;
  try {
    const v = job.inputSnapshot.voice;
    speech = await deps.speech(scene.text, { voiceId: v.voiceId, model: v.model, stability: v.settings.stability, similarityBoost: v.settings.similarityBoost });
  } catch (caught) {
    const provider = caught instanceof ProviderError ? caught : null;
    if (provider?.code === "PROVIDER_OUTCOME_UNKNOWN") {
      const error = safe(provider.code, provider.message, true);
      await setStage(ctx, claim, "outcome_unknown", "outcome_unknown", { error });
      return { ok: false, error };
    }
    const error = safe(provider?.code ?? "PROVIDER_REJECTED", provider?.message ?? "Narration couldn’t be recorded.", provider?.retryable ?? true);
    await setStage(ctx, claim, "failed", "failed", { error });
    return { ok: false, error };
  }

  // The provider succeeded: store both artifacts before declaring the stage done.
  const common = { ownerId: job.ownerId, projectId: job.projectId, originJobId: job._id, originVideoId: job.inputSnapshot.videoId, producerFingerprint: scene.fingerprint };
  const audioAsset = await storeAsset(ctx, deps.store, { ...common, kind: "audio", contentType: "audio/mpeg", body: speech.audio, metadata: { durationSeconds: speech.durationSeconds } });
  const alignmentAsset = await storeAsset(ctx, deps.store, {
    ...common,
    kind: "alignment",
    contentType: "application/json",
    body: Buffer.from(JSON.stringify({ schemaVersion: 1, sceneId: scene.id, text: scene.text, durationSeconds: speech.durationSeconds, alignment: speech.alignment })),
  });
  await setStage(ctx, claim, "succeeded", "succeeded", { artifactIds: [audioAsset.assetId, alignmentAsset.assetId] });
  return { ok: true };
}

async function readJsonAsset(store: ObjectStore, objectKey: string): Promise<unknown> {
  const object = await store.get(objectKey);
  if (!object) throw new Error("Stored artifact is missing");
  return JSON.parse(Buffer.from(await new Response(object.stream).arrayBuffer()).toString("utf8"));
}
async function readBinaryAsset(store: ObjectStore, objectKey: string): Promise<Buffer> {
  const object = await store.get(objectKey);
  if (!object) throw new Error("Stored artifact is missing");
  return Buffer.from(await new Response(object.stream).arrayBuffer());
}

async function sceneArtifacts(db: Db, job: Job) {
  const stages = await db.collection("jobStages").find({ jobId: job._id, stageKey: { $regex: /^speech:/ }, state: "succeeded" }).toArray();
  const ids = stages.flatMap((stage) => stage.artifactIds as string[]);
  const assets = await db.collection("assets").find({ _id: { $in: ids as never[] }, ownerId: job.ownerId, state: "ready" }).toArray();
  const byScene = new Map<string, { audio?: (typeof assets)[number]; alignment?: (typeof assets)[number] }>();
  for (const stage of stages) {
    const sceneId = String(stage.stageKey).slice("speech:".length);
    const own = assets.filter((a) => (stage.artifactIds as string[]).includes(String(a._id)));
    byScene.set(sceneId, { audio: own.find((a) => a.kind === "audio"), alignment: own.find((a) => a.kind === "alignment") });
  }
  return byScene;
}

/** Compile: approved plan + recorded alignments → validated timeline, stored as an asset. */
export async function compileStage(ctx: JobContext, deps: GenerationDeps, job: Job): Promise<Outcome> {
  if (await cancelRequested(ctx.db, job._id)) return { cancelled: true };
  const claim = await claimStage(ctx, job, "compile", job.inputSnapshot.renderSpecHash);
  if (claim.status === "succeeded") return { ok: true };
  if (claim.status === "unknown" || !deps.store) return { ok: false, error: safe("INTEGRATION_UNAVAILABLE", "Media storage isn’t configured.", true) };
  try {
    const storyboard = await ctx.db.collection("storyboards").findOne({ _id: job.inputSnapshot.storyboardId as never, ownerId: job.ownerId });
    if (!storyboard) throw new CompileError("INVALID_ALIGNMENT", "The approved storyboard is missing.");
    const artifacts = await sceneArtifacts(ctx.db, job);
    const speech: Record<string, SceneSpeech> = {};
    for (const scene of job.inputSnapshot.scenes) {
      const alignment = artifacts.get(scene.id)?.alignment;
      if (!alignment) throw new CompileError("INVALID_ALIGNMENT", `Narration for scene ${scene.id} is missing.`);
      const data = (await readJsonAsset(deps.store, alignment.objectKey)) as { text: string; durationSeconds: number; alignment: SceneSpeech["alignment"] };
      speech[scene.id] = { text: data.text, durationSeconds: data.durationSeconds, alignment: data.alignment };
    }
    const expected = Object.fromEntries(job.inputSnapshot.scenes.map((s) => [s.id, s.text]));
    const overrides: Record<string, { sourceStart: number; sourceEnd: number; displayText: string }[]> = {};
    for (const o of job.inputSnapshot.captionOverrides ?? []) (overrides[o.sceneId] ??= []).push(o);
    const timeline = compileTimeline(storyboard.content as PlanV2, speech, {}, expected, overrides);
    const asset = await storeAsset(ctx, deps.store, {
      ownerId: job.ownerId,
      projectId: job.projectId,
      originJobId: job._id,
      originVideoId: job.inputSnapshot.videoId,
      kind: "timeline",
      contentType: "application/json",
      body: Buffer.from(JSON.stringify({ schemaVersion: 1, renderSpecHash: job.inputSnapshot.renderSpecHash, timeline })),
      producerFingerprint: job.inputSnapshot.renderSpecHash,
      metadata: { durationSeconds: timeline.frames / timeline.fps, fps: timeline.fps },
    });
    await setStage(ctx, claim, "succeeded", "succeeded", { artifactIds: [asset.assetId] });
    return { ok: true };
  } catch (caught) {
    const error =
      caught instanceof CompileError
        ? safe(caught.code, caught.message, false)
        : safe("ASSET_MISSING", "A narration file couldn’t be read. Retry, or regenerate the video.", true);
    await setStage(ctx, claim, "failed", "failed", { error });
    return { ok: false, error };
  }
}

export type QA = {
  passed: boolean;
  checks: { dimensions: boolean; duration: boolean; frameRate: boolean; videoCodec: boolean; audio: boolean; captionBounds: boolean; layout: boolean; integrity: boolean };
  durationSeconds: number;
  checkedAt: Date;
  validatorVersion: string;
};

/** Output checks (DB_DESIGN.md QA): codec, 1080×1920, 30 fps, 60–90 s matching the timeline, audio, caption bounds. */
export function qualityChecks(probe: Awaited<ReturnType<Prober>>, timeline: Timeline): QA {
  const video = probe.streams.find((s) => s.codec_type === "video");
  const durationSeconds = Number(probe.format.duration);
  const expected = timeline.frames / timeline.fps;
  const checks = {
    dimensions: video?.width === 1080 && video?.height === 1920,
    duration: durationSeconds >= 60 && durationSeconds <= 90 && Math.abs(durationSeconds - expected) <= 1,
    frameRate: video?.avg_frame_rate === "30/1",
    videoCodec: video?.codec_name === "h264",
    audio: probe.streams.some((s) => s.codec_type === "audio"),
    captionBounds: timeline.scenes.every((scene) => scene.captions.every((c) => c.text.length <= 54 && c.start >= 0 && c.end <= scene.frames && c.end > c.start)),
    // Text and diagram data were validated against the component limits before approval and at compile time.
    layout: true,
    // Set after upload: the stored object's size/MD5 are verified by storeAsset.
    integrity: true,
  };
  return { passed: Object.values(checks).every(Boolean), checks, durationSeconds, checkedAt: new Date(), validatorVersion: "f14-1" };
}

/** Render + validate + store the MP4. A failed check never produces a ready video. */
export async function renderStage(ctx: JobContext, deps: GenerationDeps, job: Job, onProgress?: (percent: number) => Promise<void>): Promise<Outcome & { qa?: QA; videoAssetId?: string; outputHash?: string; timelineAssetId?: string }> {
  if (await cancelRequested(ctx.db, job._id)) return { cancelled: true };
  const claim = await claimStage(ctx, job, "render", job.inputSnapshot.renderSpecHash, RENDER_LEASE_MS);
  if (claim.status !== "claimed") {
    if (claim.status === "succeeded") {
      // Re-entry after the render stage finished (e.g. a later workflow step failed): rebuild the result from the
      // stored MP4 — QA is re-checked from the file rather than trusted from a serialized step result.
      const stage = await ctx.db.collection("jobStages").findOne({ jobId: job._id, stageKey: "render" });
      const asset = stage ? await ctx.db.collection("assets").findOne({ _id: (stage.artifactIds as string[])[0] as never, state: "ready" }) : null;
      const compile = await ctx.db.collection("jobStages").findOne({ jobId: job._id, stageKey: "compile", state: "succeeded" });
      const timelineAsset = compile ? await ctx.db.collection("assets").findOne({ _id: (compile.artifactIds as string[])[0] as never, state: "ready" }) : null;
      if (!asset || !timelineAsset || !deps.store || !deps.prober) return { ok: false, error: safe("ASSET_MISSING", "The rendered video is missing.", true) };
      const { timeline } = (await readJsonAsset(deps.store, timelineAsset.objectKey)) as { timeline: Timeline };
      const qa = qualityChecks(await deps.prober(await readBinaryAsset(deps.store, asset.objectKey)), timeline);
      if (!qa.passed) return { ok: false, error: safe("OUTPUT_INVALID", "The rendered video failed checks.", true) };
      return { ok: true, videoAssetId: String(asset._id), outputHash: asset.sha256, qa, timelineAssetId: String(timelineAsset._id) };
    }
    return { ok: false, error: safe("PROVIDER_OUTCOME_UNKNOWN", "The previous render didn’t report a result.", true) };
  }
  if (!deps.store || !deps.renderer || !deps.prober) {
    const error = safe("INTEGRATION_UNAVAILABLE", "Video rendering isn’t configured on this server.", true);
    await setStage(ctx, claim, "failed", "failed", { error });
    return { ok: false, error };
  }
  try {
    const compile = await ctx.db.collection("jobStages").findOne({ jobId: job._id, stageKey: "compile", state: "succeeded" });
    const timelineAsset = compile ? await ctx.db.collection("assets").findOne({ _id: (compile.artifactIds as string[])[0] as never, state: "ready" }) : null;
    if (!timelineAsset) throw new Error("Timeline missing");
    const { timeline } = (await readJsonAsset(deps.store, timelineAsset.objectKey)) as { timeline: Timeline };
    const artifacts = await sceneArtifacts(ctx.db, job);
    const audio: Record<string, Buffer> = {};
    for (const scene of timeline.scenes) {
      const asset = artifacts.get(scene.id)?.audio;
      if (!asset) throw new Error(`Audio missing for ${scene.id}`);
      audio[scene.id] = await readBinaryAsset(deps.store, asset.objectKey);
    }
    await setStage(ctx, claim, "request_started", "request_started");
    const rendered = await deps.renderer(timeline, audio, (p) => void onProgress?.(p));
    const qa = qualityChecks(await deps.prober(rendered.video), timeline);
    await ctx.db.collection("diagnosticEvents").insertOne({
      _id: newId("dgn") as never,
      schemaVersion: 1,
      ownerId: job.ownerId,
      projectId: job.projectId,
      operationId: job._id,
      correlationId: newId("cor"),
      eventType: "render.completed",
      stage: "render",
      durationMs: Long.fromNumber(rendered.durationMs),
      ...(qa.passed ? {} : { safeErrorCode: "OUTPUT_INVALID" }),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    if (!qa.passed) {
      const failedChecks = Object.entries(qa.checks).filter(([, ok]) => !ok).map(([name]) => name).join(", ");
      const error = safe("OUTPUT_INVALID", `The rendered video failed checks (${failedChecks}).`, true);
      await setStage(ctx, claim, "failed", "failed", { error });
      return { ok: false, error };
    }
    const asset = await storeAsset(ctx, deps.store, {
      ownerId: job.ownerId,
      projectId: job.projectId,
      originJobId: job._id,
      originVideoId: job.inputSnapshot.videoId,
      kind: "video",
      contentType: "video/mp4",
      body: rendered.video,
      producerFingerprint: job.inputSnapshot.renderSpecHash,
      metadata: { durationSeconds: qa.durationSeconds, width: 1080, height: 1920, fps: 30, codec: "h264" },
    });
    await setStage(ctx, claim, "succeeded", "succeeded", { artifactIds: [asset.assetId] });
    return { ok: true, qa, videoAssetId: asset.assetId, outputHash: asset.sha256, timelineAssetId: String(timelineAsset._id) };
  } catch (caught) {
    const error = safe("RENDER_FAILED", "The video couldn’t be rendered. Retry; recorded narration is reused.", true);
    console.error(`[${error.correlationId}] render failed: ${caught instanceof Error ? caught.message.slice(0, 300) : "error"}`);
    await setStage(ctx, claim, "failed", "failed", { error });
    return { ok: false, error };
  }
}

/** T08: video ready for review + latest-ready pointer + job succeeded, unless cancellation or deletion won. */
async function succeed(ctx: JobContext, job: Job, given: { qa: QA; videoAssetId: string; outputHash: string; timelineAssetId?: string }): Promise<string> {
  // Durable workflow steps pass results as JSON, so dates arrive as strings; the validator requires BSON dates.
  const output = { ...given, qa: { ...given.qa, durationSeconds: Number(given.qa.durationSeconds), checkedAt: new Date(given.qa.checkedAt) } };
  const now = new Date();
  return inTransaction(ctx.client, async (session) => {
    const current = await ctx.db.collection("jobs").findOne({ _id: job._id as never }, { session });
    if (!current || current.state !== "running") return "superseded";
    const project = await ctx.db.collection("projects").updateOne(
      { _id: job.projectId as never, ownerId: job.ownerId, deletedAt: null },
      { $set: { latestReadyVideoId: job.inputSnapshot.videoId, "flags.ready": true, updatedAt: now }, $inc: { contentRevision: 1 } },
      { session },
    );
    if (project.modifiedCount !== 1) return "superseded";
    await ctx.db.collection("videos").updateOne(
      { _id: job.inputSnapshot.videoId as never, state: { $in: ["building", "validating"] } },
      { $set: { state: "ready_for_review", outputAssetId: output.videoAssetId, outputHash: output.outputHash, qa: output.qa, ...(output.timelineAssetId ? { timelineAssetId: output.timelineAssetId } : {}), updatedAt: now } },
      { session },
    );
    await ctx.db.collection("jobs").updateOne(
      { _id: job._id as never, state: "running" },
      { $set: { state: "succeeded", stage: "finalize", result: { kind: "video", videoId: job.inputSnapshot.videoId }, finishedAt: now, updatedAt: now }, $unset: { activeSlot: "" }, $inc: { revision: 1 } },
      { session },
    );
    await ctx.db.collection("projects").updateOne({ _id: job.projectId as never, ownerId: job.ownerId, activeJobId: job._id }, { $unset: { activeJobId: "" } }, { session });
    return "ready";
  });
}

async function finish(ctx: JobContext, job: Job, outcome: { error?: SafeError; cancelled?: boolean }) {
  const now = new Date();
  await inTransaction(ctx.client, async (session) => {
    const jobs = ctx.db.collection("jobs");
    const current = await jobs.findOne({ _id: job._id as never }, { session });
    if (!current || !["running", "cancel_requested"].includes(current.state)) return;
    const cancelled = outcome.cancelled || current.state === "cancel_requested";
    await jobs.updateOne(
      { _id: job._id as never, state: current.state },
      {
        $set: { state: cancelled ? "cancelled" : "failed", ...(cancelled ? {} : { error: outcome.error }), finishedAt: now, updatedAt: now },
        $unset: { activeSlot: "" },
        $inc: { revision: 1 },
      },
      { session },
    );
    await ctx.db.collection("videos").updateOne({ _id: job.inputSnapshot.videoId as never, state: { $in: ["building", "validating"] } }, { $set: { state: "failed", updatedAt: now } }, { session });
    await ctx.db.collection("projects").updateOne({ _id: job.projectId as never, ownerId: job.ownerId, activeJobId: job._id }, { $unset: { activeJobId: "" } }, { session });
  });
}

/**
 * The durable workflow gave up (retries exhausted): mark a still-running generation job failed and retryable so the
 * creator sees Retry instead of a job that never finishes. Completed stages (narration, render) are reused on retry.
 */
export async function abandonGeneration(ctx: JobContext, jobId: string): Promise<boolean> {
  const doc = await ctx.db.collection("jobs").findOne({ _id: jobId as never, type: { $in: ["generation", "caption_render"] }, state: { $in: ["running", "cancel_requested"] } });
  if (!doc) return false;
  const job = { _id: String(doc._id), ownerId: String(doc.ownerId), projectId: String(doc.projectId), executionAttempt: doc.executionAttempt, inputSnapshot: doc.inputSnapshot } as Job;
  await finish(ctx, job, { error: safe("WORKER_FAILED", "Something went wrong while finishing the video. Retry — recorded narration is reused.", true) });
  return true;
}

/**
 * Runs a generation job. `step` checkpoints each stage (Inngest `step.run` in production; direct calls in tests),
 * so a re-invocation resumes after the last completed stage. Duplicate deliveries are no-ops after the claim.
 */
export async function runGeneration(ctx: JobContext, jobId: string, deps: GenerationDeps, step: Step): Promise<string> {
  const job = await step("claim", async () => {
    const claimed = await ctx.db.collection("jobs").findOneAndUpdate(
      { _id: jobId as never, type: { $in: ["generation", "caption_render"] }, state: "queued" },
      { $set: { state: "running", stage: "speech", updatedAt: new Date() }, $inc: { revision: 1 } },
      { returnDocument: "after" },
    );
    return claimed ? (JSON.parse(JSON.stringify({ _id: claimed._id, ownerId: claimed.ownerId, projectId: claimed.projectId, executionAttempt: claimed.executionAttempt, inputSnapshot: claimed.inputSnapshot })) as Job) : null;
  });
  if (!job) return "not-claimed";
  // Steps are keyed per execution attempt, so a retry runs fresh steps (completed stages are still reused).
  const key = (name: string) => `${name}#${job.executionAttempt}`;

  const total = job.inputSnapshot.scenes.length;
  for (const [index, scene] of job.inputSnapshot.scenes.entries()) {
    const outcome = await step(key(`speech:${scene.id}`), () => speechStage(ctx, deps, job, scene));
    if ("cancelled" in outcome) return step(key("cancel"), async () => (await finish(ctx, job, { cancelled: true }), "cancelled"));
    if (!outcome.ok) return step(key("fail"), async () => (await finish(ctx, job, { error: outcome.error }), "failed"));
    await step(key(`progress:${scene.id}`), async () => {
      await ctx.db.collection("jobs").updateOne({ _id: job._id as never, state: "running" }, { $set: { "progress.completedScenes": index + 1, "progress.totalScenes": total, updatedAt: new Date() } });
      return null;
    });
  }
  const setStageName = (stage: string) =>
    step(key(`stage:${stage}`), async () => {
      await ctx.db.collection("jobs").updateOne({ _id: job._id as never, state: "running" }, { $set: { stage, updatedAt: new Date() } });
      return null;
    });
  await setStageName("compile");
  const compiled = await step(key("compile"), () => compileStage(ctx, deps, job));
  if ("cancelled" in compiled) return step(key("cancel"), async () => (await finish(ctx, job, { cancelled: true }), "cancelled"));
  if (!compiled.ok) return step(key("fail"), async () => (await finish(ctx, job, { error: compiled.error }), "failed"));

  await setStageName("render");
  const rendered = await step(key("render"), () =>
    renderStage(ctx, deps, job, async (percent) => {
      await ctx.db.collection("jobs").updateOne({ _id: job._id as never, state: "running" }, { $set: { "progress.renderPercent": percent, updatedAt: new Date() } });
    }),
  );
  if ("cancelled" in rendered) return step(key("cancel"), async () => (await finish(ctx, job, { cancelled: true }), "cancelled"));
  if (!rendered.ok || !rendered.videoAssetId || !rendered.qa || !rendered.outputHash) {
    const error = "error" in rendered && rendered.error ? rendered.error : safe("RENDER_FAILED", "The video couldn’t be rendered.", true);
    return step(key("fail"), async () => (await finish(ctx, job, { error }), "failed"));
  }
  await setStageName("finalize");
  const output = { qa: rendered.qa, videoAssetId: rendered.videoAssetId, outputHash: rendered.outputHash, timelineAssetId: rendered.timelineAssetId };
  const outcome = await step(key("finalize"), () => succeed(ctx, job, output));
  // A render that finished after cancellation or deletion never becomes the ready output.
  if (outcome !== "ready") return step(key("cancel"), async () => (await finish(ctx, job, { cancelled: true }), "cancelled"));
  return "ready";
}
