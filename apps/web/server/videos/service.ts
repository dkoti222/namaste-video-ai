import type { Db } from "mongodb";
import { MongoServerError } from "mongodb";
import { z } from "zod";
import { canonicalJson, sha256Hex } from "../../lib/canonical";
import { findReceipt, insertReceipt, type CommandIdentity } from "../commands";
import { decodeCursor, encodeCursor } from "../cursor";
import { newId } from "../db/migrations";
import { ApiError, notFound } from "../http";
import { idRegex, inTransaction, type JobContext } from "../jobs/core";
import { availableVoices } from "../voices";

// Videos (API_DESIGN.md V01, V02, V05; DB_DESIGN.md T09). Views never include storage keys or grant URLs; playback
// and download go through short-lived V06 grants. Final approval covers exactly the bytes and spec shown.

type VideoDoc = {
  _id: string;
  ownerId: string;
  projectId: string;
  storyboardId: string;
  parentVideoId?: string;
  state: "building" | "validating" | "ready_for_review" | "approved" | "failed";
  renderSpecHash: string;
  outputHash?: string;
  outputAssetId?: string;
  qa?: { passed: boolean; checks: Record<string, boolean>; durationSeconds: number };
  resolvedVoice: { preset: string; accent: string; testOnly: boolean };
  finalApprovalId?: string;
  createdAt: Date;
};

export type VideoView = {
  id: string;
  projectId: string;
  storyboardId: string;
  parentVideoId: string | null;
  state: VideoDoc["state"];
  renderSpecHash: string;
  outputHash: string | null;
  outputAssetId: string | null;
  durationSeconds: number | null;
  width: 1080;
  height: 1920;
  fps: 30;
  voice: { preset: string; label: string; accent: string; testOnly: boolean };
  qa: { passed: boolean; checks: Record<string, boolean> } | null;
  approvalId: string | null;
  createdAt: string;
};

function toView(doc: VideoDoc): VideoView {
  const label = availableVoices().find((v) => v.preset === doc.resolvedVoice.preset)?.label ?? doc.resolvedVoice.preset;
  return {
    id: doc._id,
    projectId: doc.projectId,
    storyboardId: doc.storyboardId,
    parentVideoId: doc.parentVideoId ?? null,
    state: doc.state,
    renderSpecHash: doc.renderSpecHash,
    outputHash: doc.outputHash ?? null,
    outputAssetId: doc.outputAssetId ?? null,
    durationSeconds: doc.qa?.durationSeconds ?? null,
    width: 1080,
    height: 1920,
    fps: 30,
    voice: { preset: doc.resolvedVoice.preset, label, accent: doc.resolvedVoice.accent, testOnly: doc.resolvedVoice.testOnly },
    qa: doc.qa ? { passed: doc.qa.passed, checks: doc.qa.checks } : null,
    approvalId: doc.finalApprovalId ?? null,
    createdAt: doc.createdAt.toISOString(),
  };
}

const videos = (db: Db) => db.collection<VideoDoc>("videos");
const liveProject = (db: Db, ownerId: string, projectId: string) =>
  db.collection("projects").findOne({ _id: projectId as never, ownerId, deletedAt: null }, { projection: { _id: 1 } });

export const listVideosQuery = z.strictObject({ limit: z.coerce.number().int().min(1).max(50).default(20), cursor: z.string().max(2048).optional() });

export async function listVideos(db: Db, cursorSecret: string, ownerId: string, projectId: string, query: z.infer<typeof listVideosQuery>) {
  if (!idRegex.test(projectId) || !(await liveProject(db, ownerId, projectId))) return null;
  const binding = { ownerId, route: `videos:${projectId}`, filter: "all" };
  const filter: Record<string, unknown> = { ownerId, projectId };
  if (query.cursor) {
    const at = decodeCursor(cursorSecret, binding, query.cursor);
    filter.$or = [{ createdAt: { $lt: new Date(at.sortMs) } }, { createdAt: new Date(at.sortMs), _id: { $lt: at.id } }];
  }
  const docs = await videos(db).find(filter).sort({ createdAt: -1, _id: -1 }).limit(query.limit + 1).toArray();
  const hasMore = docs.length > query.limit;
  const page = docs.slice(0, query.limit);
  const last = page.at(-1);
  return { items: page.map(toView), hasMore, nextCursor: hasMore && last ? encodeCursor(cursorSecret, binding, { sortMs: last.createdAt.getTime(), id: last._id }) : null };
}

export async function getVideo(db: Db, ownerId: string, videoId: string): Promise<VideoView | null> {
  if (!idRegex.test(videoId)) return null;
  const doc = await videos(db).findOne({ _id: videoId, ownerId });
  if (!doc || !(await liveProject(db, ownerId, doc.projectId))) return null;
  return toView(doc);
}

export const approveVideoBody = z.strictObject({
  expectedOutputHash: z.string().regex(/^[a-f0-9]{64}$/),
  expectedRenderSpecHash: z.string().regex(/^[a-f0-9]{64}$/),
  approve: z.literal(true),
});

export const videoSubjectHash = (outputHash: string, renderSpecHash: string) => sha256Hex(canonicalJson({ outputHash, renderSpecHash }));
export type VideoApprovalView = { id: string; kind: "video"; subjectId: string; subjectHash: string; approvedAt: string };

/**
 * V05 / T09: approves exactly the reviewed bytes (output hash) and spec of a ready video. Approving the same video
 * again returns its approval. Every later version needs its own approval. The approved video becomes the project's
 * selected video (used for publishing).
 */
export async function approveVideo(ctx: JobContext, identity: CommandIdentity, videoId: string, body: z.infer<typeof approveVideoBody>): Promise<{ approval: VideoApprovalView; replayed: boolean }> {
  const { db, client } = ctx;
  const { ownerId } = identity;
  if (!idRegex.test(videoId)) throw notFound();
  const load = async (approvalId: string) => {
    const a = await db.collection("approvals").findOne({ _id: approvalId as never, ownerId });
    if (!a) throw notFound();
    return { id: String(a._id), kind: "video" as const, subjectId: a.subjectId, subjectHash: a.subjectHash, approvedAt: a.approvedAt.toISOString() };
  };
  const prior = await findReceipt(db, identity);
  if (prior) return { approval: await load(String(prior.responseBody.approvalId)), replayed: true };

  let approvalId = "";
  try {
    approvalId = await inTransaction(client, async (session) => {
      const video = await videos(db).findOne({ _id: videoId, ownerId }, { session });
      if (!video) throw notFound();
      const project = await db.collection("projects").findOne({ _id: video.projectId as never, ownerId, deletedAt: null }, { session });
      if (!project) throw notFound();
      if (video.state === "approved" && video.finalApprovalId && video.outputHash === body.expectedOutputHash && video.renderSpecHash === body.expectedRenderSpecHash) {
        return video.finalApprovalId;
      }
      if (video.state !== "ready_for_review" || !video.outputHash || !video.outputAssetId) throw new ApiError(422, "VIDEO_NOT_READY", "This video isn’t ready to approve yet.");
      if (video.outputHash !== body.expectedOutputHash || video.renderSpecHash !== body.expectedRenderSpecHash) {
        throw new ApiError(409, "HASH_MISMATCH", "This isn’t the version you reviewed. Reload and review it again.");
      }
      const asset = await db.collection("assets").findOne({ _id: video.outputAssetId as never, ownerId, state: "ready", sha256: video.outputHash }, { session, projection: { _id: 1 } });
      if (!asset) throw new ApiError(422, "VIDEO_NOT_READY", "The video file is missing. Regenerate it to continue.");
      const now = new Date();
      const newApprovalId = newId("apr");
      await db.collection("approvals").insertOne(
        { _id: newApprovalId as never, schemaVersion: 1, ownerId, projectId: video.projectId, kind: "video", subjectId: videoId, subjectHash: videoSubjectHash(video.outputHash, video.renderSpecHash), approvedBy: ownerId, approvedAt: now, reason: "explicit", createdAt: now, updatedAt: now },
        { session },
      );
      const updated = await videos(db).updateOne(
        { _id: videoId, state: "ready_for_review", outputHash: body.expectedOutputHash },
        { $set: { state: "approved", finalApprovalId: newApprovalId, updatedAt: now } as never },
        { session },
      );
      if (updated.modifiedCount !== 1) throw new ApiError(409, "HASH_MISMATCH", "This video changed. Reload it.");
      await db.collection("projects").updateOne(
        { _id: video.projectId as never, ownerId, deletedAt: null },
        { $set: { selectedVideoId: videoId, updatedAt: now }, $inc: { revision: 1, contentRevision: 1 } },
        { session },
      );
      await insertReceipt(db, session, identity, { responseStatus: 200, responseBody: { approvalId: newApprovalId }, resourceIds: [newApprovalId, videoId], projectId: video.projectId }, now);
      return newApprovalId;
    });
  } catch (error) {
    if (error instanceof MongoServerError && error.code === 11000) {
      const winner = await findReceipt(db, identity);
      if (winner) return { approval: await load(String(winner.responseBody.approvalId)), replayed: true };
    }
    throw error;
  }
  return { approval: await load(approvalId), replayed: false };
}
