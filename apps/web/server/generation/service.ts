import { Long, MongoServerError, type ClientSession, type Db } from "mongodb";
import { z } from "zod";
import { canonicalJson, sha256Hex } from "../../lib/canonical";
import { findReceipt, insertReceipt, type CommandIdentity } from "../commands";
import { newId } from "../db/migrations";
import { ApiError, notFound } from "../http";
import { idRegex, inTransaction, recoverExpiredJob, type JobContext } from "../jobs/core";
import { approveInSession } from "../storyboards/service";
import { buildRenderSpec, providerText, resolveVoice, speechFingerprint, type VoiceConfig } from "./spec";

// G01 approve & generate (T05), G03 cancel and G04 retry (T10). The video's inputs are frozen at acceptance:
// approved storyboard, resolved voice, render spec hash and per-scene provider text with speech fingerprints.

export const GENERATION_DEADLINE_MS = 60 * 60_000;

export const generationBody = z.strictObject({
  expectedDraftRevision: z.number().int().min(1),
  expectedContentHash: z.string().regex(/^[a-f0-9]{64}$/),
  approve: z.literal(true),
});
export const cancelBody = z.strictObject({ expectedRevision: z.number().int().min(1) });
export const retryBody = z.strictObject({ expectedRevision: z.number().int().min(1), acknowledgePossibleProviderRepeat: z.boolean().optional() });

export type GenerationSnapshot = {
  videoId: string;
  storyboardId: string;
  approvalId: string;
  renderSpecHash: string;
  voice: VoiceConfig;
  scenes: { id: string; text: string; fingerprint: string }[];
  /** Display-only caption corrections (F16); speech and timing are unchanged. */
  captionOverrides?: { sceneId: string; speechFingerprint: string; sourceStart: number; sourceEnd: number; displayText: string }[];
};

export type AcceptedOperation = { jobId: string; resource: { kind: "video"; id: string } | null; state: "queued"; statusUrl: string };
const operation = (jobId: string, videoId: string): AcceptedOperation => ({ jobId, resource: { kind: "video", id: videoId }, state: "queued", statusUrl: `/api/jobs/${jobId}` });

async function insertOutbox(db: Db, session: ClientSession, ownerId: string, projectId: string, jobId: string, now: Date) {
  await db.collection("outbox").insertOne(
    {
      _id: newId("obx") as never,
      schemaVersion: 1,
      ownerId,
      projectId,
      eventId: newId("evt"),
      aggregateId: jobId,
      eventType: "job.generation.requested",
      payloadIds: { jobId },
      state: "pending",
      attempts: 0,
      availableAt: now,
      createdAt: now,
      updatedAt: now,
    },
    { session },
  );
}

/**
 * G01: in one transaction — live parent with a free content slot, exact-draft story approval (shared T05 rules),
 * server-resolved voice, immutable render spec, video (building), generation job holding the slot, outbox, receipt.
 */
export async function acceptGeneration(ctx: JobContext, identity: CommandIdentity, projectId: string, body: z.infer<typeof generationBody>): Promise<{ operation: AcceptedOperation; replayed: boolean }> {
  const { db, client } = ctx;
  const { ownerId } = identity;
  if (!idRegex.test(projectId)) throw notFound();
  const prior = await findReceipt(db, identity);
  if (prior) return { operation: operation(String(prior.responseBody.jobId), String(prior.responseBody.videoId)), replayed: true };

  const jobId = newId("job");
  const videoId = newId("vid");
  try {
    await inTransaction(client, async (session) => {
      const now = new Date();
      const project = await db.collection("projects").findOne({ _id: projectId as never, ownerId, deletedAt: null }, { session });
      if (!project) throw notFound();
      if (project.activeJobId) await recoverExpiredJob(db, session, ownerId, projectId, project.activeJobId, now);
      const busy = await db.collection("projects").findOne({ _id: projectId as never, ownerId, deletedAt: null, activeJobId: { $exists: true } }, { session, projection: { activeJobId: 1 } });
      if (busy) throw new ApiError(409, "PROJECT_BUSY", "Another task is still running for this video. Wait for it to finish.", { details: { activeJobId: busy.activeJobId } });

      const approved = await approveInSession(db, session, ownerId, projectId, body);
      const voice = resolveVoice(approved.plan.voicePreset);
      if (!voice) throw new ApiError(422, "VOICE_UNAVAILABLE", "This narrator isn’t available. Choose another voice.");
      const { renderSpec, renderSpecHash } = buildRenderSpec({ id: approved.storyboardId, storyHash: approved.storyHash }, voice);
      const snapshot: GenerationSnapshot = {
        videoId,
        storyboardId: approved.storyboardId,
        approvalId: approved.approvalId,
        renderSpecHash,
        voice,
        scenes: approved.plan.scenes.map((scene) => {
          const text = providerText(scene);
          return { id: scene.id, text, fingerprint: speechFingerprint(ownerId, projectId, voice, text) };
        }),
      };

      await db.collection("videos").insertOne(
        {
          _id: videoId as never,
          schemaVersion: 1,
          ownerId,
          projectId,
          storyboardId: approved.storyboardId,
          storyApprovalId: approved.approvalId,
          renderSpec,
          renderSpecHash,
          state: "building",
          resolvedVoice: voice,
          rendererBuildId: renderSpec.rendererBuildId,
          createdAt: now,
          updatedAt: now,
        },
        { session },
      );
      await db.collection("jobs").insertOne(
        {
          _id: jobId as never,
          schemaVersion: 1,
          ownerId,
          projectId,
          type: "generation",
          state: "queued",
          revision: 1,
          stage: "queued",
          inputSnapshot: snapshot,
          inputHash: sha256Hex(canonicalJson({ type: "generation", renderSpecHash, scenes: snapshot.scenes })),
          executionAttempt: 1,
          progress: { completedScenes: 0, totalScenes: snapshot.scenes.length },
          deadlineAt: new Date(now.getTime() + GENERATION_DEADLINE_MS),
          activeSlot: true,
          createdAt: now,
          updatedAt: now,
        },
        { session },
      );
      const claimed = await db.collection("projects").updateOne(
        { _id: projectId as never, ownerId, deletedAt: null, activeJobId: { $exists: false } },
        { $set: { activeJobId: jobId, updatedAt: now }, $inc: { contentRevision: 1 } },
        { session },
      );
      if (claimed.modifiedCount !== 1) throw new ApiError(409, "PROJECT_BUSY", "Another task is still running for this video.");
      await insertOutbox(db, session, ownerId, projectId, jobId, now);
      await insertReceipt(db, session, identity, { responseStatus: 202, responseBody: { jobId, videoId }, resourceIds: [jobId, videoId], projectId }, now);
    });
  } catch (error) {
    if (error instanceof MongoServerError && error.code === 11000) {
      const winner = await findReceipt(db, identity);
      if (winner) return { operation: operation(String(winner.responseBody.jobId), String(winner.responseBody.videoId)), replayed: true };
      throw new ApiError(409, "PROJECT_BUSY", "Another task is still running for this video.");
    }
    throw error;
  }
  return { operation: operation(jobId, videoId), replayed: false };
}

async function ownedJob(db: Db, session: ClientSession, ownerId: string, jobId: string) {
  if (!idRegex.test(jobId)) throw notFound();
  const job = await db.collection("jobs").findOne({ _id: jobId as never, ownerId }, { session });
  if (!job) throw notFound();
  const project = await db.collection("projects").findOne({ _id: job.projectId, ownerId, deletedAt: null }, { session, projection: { _id: 1 } });
  if (!project) throw notFound();
  return job;
}

/** G03: queued jobs cancel immediately; running jobs move to cancel_requested and stop at the next stage boundary. */
export async function cancelJob(ctx: JobContext, identity: CommandIdentity, jobId: string, body: z.infer<typeof cancelBody>) {
  const { db, client } = ctx;
  const prior = await findReceipt(db, identity);
  if (prior) return { jobId, replayed: true };
  try {
    await inTransaction(client, async (session) => {
      const job = await ownedJob(db, session, identity.ownerId, jobId);
      if (job.type === "cleanup") throw new ApiError(409, "JOB_TERMINAL", "This task can’t be cancelled.");
      if (job.revision !== body.expectedRevision) throw new ApiError(409, "REVISION_CONFLICT", "This task changed. Reload it.", { details: { currentRevision: job.revision } });
      const now = new Date();
      if (job.state === "queued") {
        await db.collection("jobs").updateOne(
          { _id: job._id, state: "queued", revision: job.revision },
          { $set: { state: "cancelled", cancellationRequestedAt: now, finishedAt: now, updatedAt: now }, $unset: { activeSlot: "" }, $inc: { revision: 1 } },
          { session },
        );
        await db.collection("projects").updateOne({ _id: job.projectId, ownerId: identity.ownerId, activeJobId: jobId }, { $unset: { activeJobId: "" } }, { session });
        if (job.type === "generation") await db.collection("videos").updateOne({ _id: job.inputSnapshot.videoId, state: "building" }, { $set: { state: "failed", updatedAt: now } }, { session });
      } else if (job.state === "running") {
        await db.collection("jobs").updateOne(
          { _id: job._id, state: "running", revision: job.revision },
          { $set: { state: "cancel_requested", cancellationRequestedAt: now, updatedAt: now }, $inc: { revision: 1 } },
          { session },
        );
      } else {
        throw new ApiError(409, "JOB_TERMINAL", job.state === "cancel_requested" ? "Cancellation is already in progress." : "This task has already finished.");
      }
      await insertReceipt(db, session, identity, { responseStatus: 200, responseBody: { jobId }, resourceIds: [jobId], projectId: job.projectId }, now);
    });
  } catch (error) {
    if (error instanceof MongoServerError && error.code === 11000 && (await findReceipt(db, identity))) return { jobId, replayed: true };
    throw error;
  }
  return { jobId, replayed: false };
}

/**
 * G04: a failed generation re-runs on its unchanged inputs as a new execution attempt. Completed stages are reused;
 * a stage whose provider outcome is unknown requires explicit acknowledgement that usage may repeat.
 */
export async function retryJob(ctx: JobContext, identity: CommandIdentity, jobId: string, body: z.infer<typeof retryBody>): Promise<{ operation: AcceptedOperation; replayed: boolean }> {
  const { db, client } = ctx;
  const prior = await findReceipt(db, identity);
  if (prior) return { operation: operation(jobId, String(prior.responseBody.videoId)), replayed: true };
  let videoId = "";
  try {
    await inTransaction(client, async (session) => {
      const job = await ownedJob(db, session, identity.ownerId, jobId);
      if (!["generation", "caption_render"].includes(job.type) || job.state !== "failed" || job.error?.retryable === false) {
        throw new ApiError(409, "JOB_NOT_RETRYABLE", "This task can’t be retried. Start a new one instead.");
      }
      if (job.revision !== body.expectedRevision) throw new ApiError(409, "REVISION_CONFLICT", "This task changed. Reload it.", { details: { currentRevision: job.revision } });
      const now = new Date();
      const unknown = await db.collection("jobStages").countDocuments({ jobId, state: "outcome_unknown" }, { session });
      if (unknown && !body.acknowledgePossibleProviderRepeat) {
        throw new ApiError(409, "REPEAT_ACK_REQUIRED", "A narration request may already have been charged. Confirm that it may be repeated.");
      }
      if (job.projectId) await recoverExpiredJob(db, session, identity.ownerId, job.projectId, String((await db.collection("projects").findOne({ _id: job.projectId }, { session }))?.activeJobId ?? ""), now);
      const claimed = await db.collection("projects").updateOne(
        { _id: job.projectId, ownerId: identity.ownerId, deletedAt: null, activeJobId: { $exists: false } },
        { $set: { activeJobId: jobId, updatedAt: now }, $inc: { contentRevision: 1 } },
        { session },
      );
      if (claimed.modifiedCount !== 1) throw new ApiError(409, "PROJECT_BUSY", "Another task is running for this video.");
      await db.collection("jobStages").updateMany(
        { jobId, state: { $in: ["failed", "outcome_unknown", "leased", "request_started", "cancelled"] } },
        { $set: { state: "pending", updatedAt: now }, $unset: { lease: "", error: "", currentAttemptId: "" } },
        { session },
      );
      await db.collection("jobs").updateOne(
        { _id: job._id, state: "failed", revision: job.revision },
        {
          $set: { state: "queued", stage: "queued", activeSlot: true, deadlineAt: new Date(now.getTime() + GENERATION_DEADLINE_MS), updatedAt: now },
          $unset: { error: "", finishedAt: "", cancellationRequestedAt: "" },
          $inc: { revision: 1, executionAttempt: 1 },
        },
        { session },
      );
      videoId = job.inputSnapshot.videoId;
      // A failed video that was never ready may return to building for an explicit retry of its unchanged spec.
      await db.collection("videos").updateOne({ _id: videoId as never, state: "failed" }, { $set: { state: "building", updatedAt: now } }, { session });
      await insertOutbox(db, session, identity.ownerId, job.projectId, jobId, now);
      await insertReceipt(db, session, identity, { responseStatus: 202, responseBody: { jobId, videoId }, resourceIds: [jobId, videoId], projectId: job.projectId }, now);
    });
  } catch (error) {
    if (error instanceof MongoServerError && error.code === 11000) {
      const winner = await findReceipt(db, identity);
      if (winner) return { operation: operation(jobId, String(winner.responseBody.videoId)), replayed: true };
    }
    throw error;
  }
  return { operation: operation(jobId, videoId), replayed: false };
}

export { Long };
