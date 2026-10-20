import { type ClientSession, type Db } from "mongodb";
import { z } from "zod";
import { canonicalJson, sha256Hex } from "../../lib/canonical";
import type { AuthServices } from "../auth/auth";
import { findReceipt, insertReceipt, type CommandIdentity } from "../commands";
import { decodeCursor, encodeCursor } from "../cursor";
import { newId } from "../db/migrations";
import { ApiError, notFound } from "../http";
import { readInstagramConfig } from "../instagram/config";
import { inTransaction } from "../jobs/core";
import { mediaPublicOrigin } from "./media-origin";

// U02–U04, U06, U07 (API_DESIGN.md section 10; SYSTEM_DESIGN.md 12.2). "Post now" freezes the exact approved video,
// account identity and caption into a payload + hash before any Meta call. Scheduling (mode "schedule") is F20.

export const CAPTION_MAX = 2200;
/** Lateness/retry window from the intended start (acceptance time for "now"). */
export const RETRY_WINDOW_MS = 15 * 60_000;
export const PUBLISH_EVENT_TYPE = "publish.requested";

export type PublishState =
  | "scheduled" | "queued" | "claimed" | "preparing" | "processing" | "submitting"
  | "published" | "paused_auth" | "failed_safe" | "outcome_unknown" | "needs_attention" | "cancelled";

const id = z.string().regex(/^[a-z]{2,8}_[A-Za-z0-9_-]{16,64}$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const caption = z
  .string()
  .max(CAPTION_MAX * 2)
  .refine((value) => [...value].length <= CAPTION_MAX, { message: `Captions can be at most ${CAPTION_MAX} characters.` })
  // Plain text: no control characters other than newlines and tabs.
  .refine((value) => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value), { message: "Captions must be plain text." });

export const publishBody = z
  .object({
    projectId: id,
    payload: z
      .object({
        videoId: id,
        videoApprovalId: id,
        expectedOutputHash: hash,
        destination: z.object({ connectionId: id, instagramUserId: z.string().min(1).max(100), destinationEpoch: z.number().int().min(1) }).strict(),
        caption,
      })
      .strict(),
    mode: z.enum(["now", "schedule"]),
    schedule: z.unknown().optional(),
    confirm: z.literal(true),
    repostOfIntentId: id.optional(),
  })
  .strict();
export const revisionBody = z.object({ expectedRevision: z.number().int().min(1) }).strict();
export const retryBody = z.object({ expectedRevision: z.number().int().min(1), confirm: z.literal(true) }).strict();

export type PublishIntentView = {
  id: string;
  projectId: string;
  revision: number;
  state: PublishState;
  payloadId: string;
  payloadHash: string;
  videoId: string;
  assetHash: string;
  destination: { connectionId: string; instagramUserId: string; destinationEpoch: number; usernameAtApproval: string };
  caption: string;
  schedule: null;
  publishedAt: string | null;
  providerMediaId: string | null;
  permalink: string | null;
  error: { code: string; message: string; retryable: boolean } | null;
  actions: { edit: boolean; cancel: boolean; retry: boolean; reconnect: boolean };
  createdAt: string;
  updatedAt: string;
};

const intents = (db: Db) => db.collection("publishIntents");
const payloads = (db: Db) => db.collection("publishPayloads");
const CANCELLABLE: PublishState[] = ["queued", "scheduled", "failed_safe", "paused_auth", "needs_attention"];

/** Publishing needs Instagram configured plus a public media origin Instagram can fetch from. */
export function publishingConfigured(): boolean {
  return readInstagramConfig() !== null && mediaPublicOrigin() !== null;
}

function view(intent: Record<string, unknown>, payload: Record<string, unknown>, now = new Date()): PublishIntentView {
  const state = intent.state as PublishState;
  const unclaimed = !intent.claim || (intent.claim as { until: Date }).until.getTime() < now.getTime();
  const beforeSubmission = intent.submissionBarrier !== true;
  const withinWindow = (intent.retryDeadlineAt as Date).getTime() > now.getTime();
  const error = intent.error as { code: string; message: string; retryable: boolean } | undefined;
  return {
    id: String(intent._id),
    projectId: String(intent.projectId),
    revision: Number(intent.revision),
    state,
    payloadId: String(payload._id),
    payloadHash: String(payload.payloadHash),
    videoId: String(payload.videoId),
    assetHash: String(payload.outputHash),
    destination: {
      connectionId: String(payload.connectionId),
      instagramUserId: String(payload.instagramUserId),
      destinationEpoch: Number(payload.destinationEpoch),
      usernameAtApproval: String(payload.usernameAtApproval),
    },
    caption: String(payload.caption),
    schedule: null,
    publishedAt: intent.publishedAt instanceof Date ? intent.publishedAt.toISOString() : null,
    providerMediaId: typeof intent.providerMediaId === "string" ? intent.providerMediaId : null,
    permalink: typeof intent.permalink === "string" ? intent.permalink : null,
    error: error ? { code: error.code, message: error.message, retryable: error.retryable } : null,
    actions: {
      edit: false, // replacing a payload (U05) arrives with scheduling (F20)
      cancel: CANCELLABLE.includes(state) && unclaimed && beforeSubmission,
      retry: ["failed_safe", "paused_auth", "needs_attention"].includes(state) && unclaimed && beforeSubmission && withinWindow,
      reconnect: state === "paused_auth",
    },
    createdAt: (intent.createdAt as Date).toISOString(),
    updatedAt: (intent.updatedAt as Date).toISOString(),
  };
}

async function loadView(db: Db, ownerId: string, intentId: string, session?: ClientSession): Promise<PublishIntentView | null> {
  const intent = await intents(db).findOne({ _id: intentId as never, ownerId }, { session });
  if (!intent) return null;
  const project = await db.collection("projects").findOne({ _id: intent.projectId as never, ownerId, deletedAt: null }, { session, projection: { _id: 1 } });
  if (!project) return null;
  const payload = await payloads(db).findOne({ _id: intent.payloadId as never }, { session });
  return payload ? view(intent, payload) : null;
}

/** U04 */
export async function getIntent(db: Db, ownerId: string, intentId: string): Promise<PublishIntentView> {
  if (!id.safeParse(intentId).success) throw notFound();
  const found = await loadView(db, ownerId, intentId);
  if (!found) throw notFound();
  return found;
}

/** U03: newest first with a signed cursor. */
export async function listIntents(db: Db, cursorSecret: string, ownerId: string, projectId: string, { limit = 20, cursor }: { limit?: number; cursor?: string | null }) {
  const project = await db.collection("projects").findOne({ _id: projectId as never, ownerId, deletedAt: null }, { projection: { _id: 1 } });
  if (!project) throw notFound();
  const filter: Record<string, unknown> = { ownerId, projectId };
  const binding = { ownerId, route: "publish-intents", filter: projectId };
  if (cursor) {
    const at = decodeCursor(cursorSecret, binding, cursor);
    filter.$or = [{ createdAt: { $lt: new Date(at.sortMs) } }, { createdAt: new Date(at.sortMs), _id: { $lt: at.id } }];
  }
  const rows = await intents(db).find(filter).sort({ createdAt: -1, _id: -1 }).limit(limit + 1).toArray();
  const page = rows.slice(0, limit);
  const payloadDocs = await payloads(db).find({ _id: { $in: page.map((r) => r.payloadId) } }).toArray();
  const byId = new Map(payloadDocs.map((p) => [String(p._id), p]));
  const items = page.filter((r) => byId.has(String(r.payloadId))).map((r) => view(r, byId.get(String(r.payloadId))!));
  const last = page.at(-1);
  const nextCursor = rows.length > limit && last ? encodeCursor(cursorSecret, binding, { sortMs: (last.createdAt as Date).getTime(), id: String(last._id) }) : null;
  return { items, page: { nextCursor, hasMore: nextCursor !== null } };
}

async function insertPublishOutbox(db: Db, session: ClientSession, ownerId: string, projectId: string, intentId: string, now: Date) {
  await db.collection("outbox").insertOne(
    { _id: newId("obx") as never, schemaVersion: 1, ownerId, projectId, eventId: newId("evt"), aggregateId: intentId, eventType: PUBLISH_EVENT_TYPE, payloadIds: { intentId }, state: "pending", attempts: 0, availableAt: now, createdAt: now, updatedAt: now },
    { session },
  );
}

const busy = (message: string, code = "PUBLISH_INTENT_EXISTS", details?: Record<string, unknown>) => new ApiError(409, code, message, details ? { details } : {});

/**
 * U02 (K): validates the approved video/asset, the live destination and the caption, freezes payload + hash and
 * queues delivery (outbox). A matching unresolved payload is returned instead of creating a second one.
 */
export async function acceptPublish(services: Pick<AuthServices, "db" | "client">, identity: CommandIdentity, body: z.infer<typeof publishBody>) {
  const { db, client } = services;
  const prior = await findReceipt(db, identity);
  if (prior) return { intent: (await loadView(db, identity.ownerId, prior.resourceIds[0]))!, status: prior.responseStatus, deduplicated: false, replayed: true };
  if (body.mode !== "now") throw new ApiError(422, "INVALID_SCHEDULE", "Scheduling posts arrives in a later update. Use Post now.");
  if (body.schedule !== undefined) throw new ApiError(422, "VALIDATION_FAILED", "A schedule is only allowed when scheduling.", { fieldErrors: [{ path: "schedule", code: "FORBIDDEN", message: "Remove schedule for Post now." }] });
  if (!publishingConfigured()) throw new ApiError(503, "PUBLISHING_UNAVAILABLE", "Posting to Instagram isn’t available on this server right now.", { retryable: true });

  const { ownerId } = identity;
  const { payload } = body;
  const project = await db.collection("projects").findOne({ _id: body.projectId as never, ownerId, deletedAt: null });
  if (!project) throw notFound();
  const video = await db.collection("videos").findOne({ _id: payload.videoId as never, ownerId, projectId: body.projectId });
  if (!video) throw notFound();
  if (video.state !== "approved" || video.finalApprovalId !== payload.videoApprovalId) {
    throw new ApiError(422, "VIDEO_NOT_APPROVED", "Approve this exact video version before posting it.");
  }
  if (video.outputHash !== payload.expectedOutputHash) throw new ApiError(409, "HASH_MISMATCH", "This video changed since you reviewed it. Reload and review it again.");
  const approval = await db.collection("approvals").findOne({ _id: payload.videoApprovalId as never, ownerId, kind: "video", subjectId: payload.videoId });
  const asset = await db.collection("assets").findOne({ _id: video.outputAssetId as never, ownerId, state: "ready", sha256: video.outputHash });
  if (!approval || !asset) throw new ApiError(422, "VIDEO_NOT_APPROVED", "This video’s approval or file is unavailable. Review it again.");

  const connection = await db.collection("instagramConnections").findOne({ ownerId });
  const healthy = connection && ["connected", "expiring"].includes(String(connection.state)) && !connection.reconciliationOnly && typeof connection.instagramUserId === "string" && (!(connection.expiresAt instanceof Date) || connection.expiresAt.getTime() > Date.now());
  if (!healthy) throw new ApiError(409, "RECONNECT_REQUIRED", "Reconnect Instagram in Settings before posting.", { details: { reconnectUrl: `/settings` } });
  const destination = payload.destination;
  if (String(connection._id) !== destination.connectionId || connection.instagramUserId !== destination.instagramUserId || Number(connection.destinationEpoch) !== destination.destinationEpoch) {
    throw new ApiError(409, "DESTINATION_CHANGED", "Your Instagram account changed. Review the account and confirm again.", { details: { username: connection.username } });
  }

  const contentKey = sha256Hex(canonicalJson({ videoId: payload.videoId, outputHash: video.outputHash, instagramUserId: destination.instagramUserId, caption: payload.caption }));
  const payloadHash = sha256Hex(
    canonicalJson({ videoId: payload.videoId, videoApprovalId: payload.videoApprovalId, assetId: String(asset._id), outputHash: video.outputHash, destination, caption: payload.caption, mode: "now" }),
  );

  // Same payload still unresolved → return it (even under a different key).
  const existing = await intents(db).findOne({ ownerId, videoId: payload.videoId, instagramUserId: destination.instagramUserId, contentKey, unresolved: true });
  if (existing) return { intent: (await loadView(db, ownerId, String(existing._id)))!, status: 200, deduplicated: true, replayed: false };
  // Already published → an intentional repost must reference that post and be confirmed again.
  const published = await intents(db).findOne({ ownerId, videoId: payload.videoId, instagramUserId: destination.instagramUserId, contentKey, state: "published" }, { sort: { publishedAt: -1 } });
  if (published && body.repostOfIntentId !== String(published._id)) {
    throw busy("This video was already posted to this account with the same caption. Confirm a repost to post it again.", "ALREADY_PUBLISHED", { intentId: String(published._id) });
  }
  if (body.repostOfIntentId && !published) throw new ApiError(422, "VALIDATION_FAILED", "There is no earlier post to repost.");

  const now = new Date();
  const intentId = newId("pin");
  const payloadId = newId("ppl");
  try {
    await inTransaction(client, async (session) => {
      const live = await db.collection("projects").findOne({ _id: body.projectId as never, ownerId, deletedAt: null }, { session, projection: { _id: 1 } });
      if (!live) throw notFound();
      await insertReceipt(db, session, identity, { responseStatus: 201, responseBody: { intentId }, resourceIds: [intentId], projectId: body.projectId }, now);
      await payloads(db).insertOne(
        {
          _id: payloadId as never,
          schemaVersion: 1,
          ownerId,
          projectId: body.projectId,
          intentId,
          revision: 1,
          videoId: payload.videoId,
          videoApprovalId: payload.videoApprovalId,
          assetId: String(asset._id),
          outputHash: String(video.outputHash),
          connectionId: destination.connectionId,
          instagramUserId: destination.instagramUserId,
          usernameAtApproval: String(connection.username),
          destinationEpoch: destination.destinationEpoch,
          caption: payload.caption,
          mode: "now",
          approvedBy: ownerId,
          approvedAt: now,
          payloadHash,
          contentKey,
          ...(body.repostOfIntentId ? { repostOfIntentId: body.repostOfIntentId } : {}),
          createdAt: now,
          updatedAt: now,
        },
        { session },
      );
      await intents(db).insertOne(
        {
          _id: intentId as never,
          schemaVersion: 1,
          ownerId,
          projectId: body.projectId,
          revision: 1,
          payloadId,
          payloadRevision: 1,
          videoId: payload.videoId,
          instagramUserId: destination.instagramUserId,
          contentKey,
          state: "queued",
          unresolved: true,
          dueAt: now,
          retryDeadlineAt: new Date(now.getTime() + RETRY_WINDOW_MS),
          submissionBarrier: false,
          createdAt: now,
          updatedAt: now,
        },
        { session },
      );
      await insertPublishOutbox(db, session, ownerId, body.projectId, intentId, now);
    });
  } catch (error) {
    // intent_unresolved unique index: a concurrent identical request won; return its intent.
    if ((error as { code?: number }).code === 11000) {
      const winner = await intents(db).findOne({ ownerId, videoId: payload.videoId, instagramUserId: destination.instagramUserId, contentKey, unresolved: true });
      if (winner) return { intent: (await loadView(db, ownerId, String(winner._id)))!, status: 200, deduplicated: true, replayed: false };
    }
    throw error;
  }
  return { intent: (await loadView(db, ownerId, intentId))!, status: 201, deduplicated: false, replayed: false };
}

async function intentCommand(services: Pick<AuthServices, "db" | "client">, identity: CommandIdentity, intentId: string, expectedRevision: number, apply: (intent: Record<string, unknown>, now: Date) => Record<string, unknown>) {
  const { db, client } = services;
  const prior = await findReceipt(db, identity);
  if (prior) return { intent: (await loadView(db, identity.ownerId, intentId))!, replayed: true };
  const current = await loadView(db, identity.ownerId, intentId);
  if (!current) throw notFound();
  const intent = (await intents(db).findOne({ _id: intentId as never, ownerId: identity.ownerId }))!;
  if (Number(intent.revision) !== expectedRevision) throw new ApiError(409, "REVISION_CONFLICT", "This post changed. Reload to see its latest status.", { details: { currentRevision: Number(intent.revision) } });
  const now = new Date();
  const update = apply(intent, now);
  await inTransaction(client, async (session) => {
    const result = await intents(db).updateOne(
      { _id: intentId as never, ownerId: identity.ownerId, revision: expectedRevision, submissionBarrier: false, $or: [{ claim: { $exists: false } }, { "claim.until": { $lt: now } }] },
      { ...update, $inc: { revision: 1 } },
      { session },
    );
    if (result.modifiedCount !== 1) throw new ApiError(409, "INTENT_ALREADY_CLAIMED", "Publishing has already started, so this can’t be changed now.");
    await insertReceipt(db, session, identity, { responseStatus: 200, responseBody: { intentId }, resourceIds: [intentId], projectId: String(intent.projectId) }, now);
    if (update.$set && (update.$set as Record<string, unknown>).state === "queued") {
      await insertPublishOutbox(db, session, identity.ownerId, String(intent.projectId), intentId, now);
    }
  });
  return { intent: (await loadView(db, identity.ownerId, intentId))!, replayed: false };
}

/** U06: cancel before a worker claims it; never after a publish request may have been sent. */
export async function cancelIntent(services: Pick<AuthServices, "db" | "client">, identity: CommandIdentity, intentId: string, body: z.infer<typeof revisionBody>) {
  return intentCommand(services, identity, intentId, body.expectedRevision, (intent, now) => {
    const state = intent.state as PublishState;
    if (state === "outcome_unknown") throw new ApiError(409, "OUTCOME_UNKNOWN", "Instagram may already have this post. We’re checking — it can’t be cancelled.");
    if (intent.submissionBarrier === true || !CANCELLABLE.includes(state)) throw new ApiError(409, "INTENT_ALREADY_CLAIMED", "Publishing has already started, so it can’t be cancelled.");
    return { $set: { state: "cancelled", unresolved: false, updatedAt: now }, $unset: { nextCheckAt: "", claim: "" } };
  });
}

/** U07: explicit retry of a safe failure within the 15-minute window; never after an uncertain submission. */
export async function retryIntent(services: Pick<AuthServices, "db" | "client">, identity: CommandIdentity, intentId: string, body: z.infer<typeof retryBody>) {
  const { db } = services;
  const intent = await intents(db).findOne({ _id: intentId as never, ownerId: identity.ownerId });
  if (intent?.state === "paused_auth") {
    const connection = await db.collection("instagramConnections").findOne({ ownerId: identity.ownerId });
    const payload = await payloads(db).findOne({ _id: intent.payloadId as never });
    const same = connection && payload && ["connected", "expiring"].includes(String(connection.state)) && connection.instagramUserId === payload.instagramUserId && Number(connection.destinationEpoch) === Number(payload.destinationEpoch);
    if (!same) throw new ApiError(409, "RECONNECT_REQUIRED", "Reconnect the same Instagram account in Settings, then retry.");
  }
  return intentCommand(services, identity, intentId, body.expectedRevision, (current, now) => {
    const state = current.state as PublishState;
    if (state === "outcome_unknown") throw new ApiError(409, "OUTCOME_UNKNOWN", "Instagram may already have this post. We’re checking instead of posting again.");
    if (!["failed_safe", "paused_auth", "needs_attention"].includes(state) || current.submissionBarrier === true) throw new ApiError(409, "INTENT_NOT_RETRYABLE", "This post can’t be retried.");
    if ((current.retryDeadlineAt as Date).getTime() <= now.getTime()) throw new ApiError(409, "RETRY_WINDOW_EXPIRED", "The 15-minute posting window has passed. Cancel this post, then post again.");
    return { $set: { state: "queued", dueAt: now, updatedAt: now }, $unset: { error: "", nextCheckAt: "", claim: "" } };
  });
}
