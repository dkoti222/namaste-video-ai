import { Long, type Db } from "mongodb";
import { newId } from "../db/migrations";
import { readInstagramConfig } from "../instagram/config";
import { decryptToken, type EncryptedSecret } from "../instagram/crypto";
import { getInstagramPublisher, InstagramProviderError, type InstagramPublisher } from "../instagram/provider";
import { createIngestGrant, revokeIntentGrants } from "../media/assets";
import { mediaPublicOrigin } from "./media-origin";

// Delivery algorithm (SYSTEM_DESIGN.md 12.3). Each call claims the intent under a lease, does one bounded piece of
// work, persists the result and releases the claim. The submission barrier is persisted before media_publish; after
// it, uncertainty becomes outcome_unknown and is reconciled from the saved container — never re-published blindly.

export type AdvanceResult = "published" | "processing" | "outcome_unknown" | "failed_safe" | "paused_auth" | "needs_attention" | "cancelled" | "skipped";

const LEASE_MS = 3 * 60_000;
const POLL_MS = 10_000;
const PROCESSING_TIMEOUT_MS = 15 * 60_000;
const RECONCILE_MS = 60_000;
const RECONCILE_GIVE_UP_MS = 24 * 60 * 60_000;

type Deps = { publisher?: InstagramPublisher; now?: () => Date };

const safeError = (code: string, message: string, retryable: boolean) => ({ code, message, retryable, correlationId: newId("cor") });

export async function advancePublish(db: Db, intentId: string, deps: Deps = {}): Promise<AdvanceResult> {
  const now = deps.now?.() ?? new Date();
  const holder = newId("lse");
  const intents = db.collection("publishIntents");
  const claimed = await intents.findOneAndUpdate(
    {
      _id: intentId as never,
      $and: [
        { $or: [{ claim: { $exists: false } }, { "claim.until": { $lt: now } }] },
        {
          $or: [
            { state: "queued", dueAt: { $lte: now } },
            { state: { $in: ["processing", "outcome_unknown"] }, nextCheckAt: { $lte: now } },
            // A worker died mid-step: resume from the persisted state.
            { state: { $in: ["claimed", "preparing", "submitting"] } },
          ],
        },
      ],
    },
    { $set: { claim: { holder, until: new Date(now.getTime() + LEASE_MS), fence: Long.fromNumber(now.getTime()) }, updatedAt: now } },
    { returnDocument: "after" },
  );
  if (!claimed) return "skipped";

  const ownerId = String(claimed.ownerId);
  const fenced = { _id: claimed._id, "claim.holder": holder };
  const attempts = db.collection("publishAttempts");
  const payload = await db.collection("publishPayloads").findOne({ _id: claimed.payloadId as never });
  const config = readInstagramConfig();
  const publisher = config ? (deps.publisher ?? getInstagramPublisher(config)) : null;

  /** Persists a new intent state and releases the claim (fenced by the lease holder). */
  async function settle(state: AdvanceResult | "submitting", set: Record<string, unknown> = {}, unset: Record<string, ""> = {}) {
    const at = deps.now?.() ?? new Date();
    const resolved = state === "published" || state === "cancelled";
    await intents.updateOne(fenced, {
      $set: { state, unresolved: !resolved, updatedAt: at, ...set },
      $unset: { claim: "", ...unset },
      $inc: { revision: 1 },
    });
    if (resolved || state === "failed_safe" || state === "needs_attention" || state === "paused_auth") await revokeIntentGrants(db, ownerId, intentId);
    return state as AdvanceResult;
  }
  const fail = (code: string, message: string, retryable = true, resetBarrier = false) =>
    settle("failed_safe", { error: safeError(code, message, retryable), ...(resetBarrier ? { submissionBarrier: false } : {}) }, { nextCheckAt: "" });

  if (!payload || !config || !publisher) return fail("PUBLISHING_UNAVAILABLE", "Posting to Instagram isn’t available right now.");

  const connection = await db.collection("instagramConnections").findOne({ ownerId });
  const destinationOk =
    connection &&
    ["connected", "expiring"].includes(String(connection.state)) &&
    !connection.reconciliationOnly &&
    connection.instagramUserId === payload.instagramUserId &&
    Number(connection.destinationEpoch) === Number(payload.destinationEpoch) &&
    connection.encryptedToken &&
    (!(connection.expiresAt instanceof Date) || connection.expiresAt.getTime() > now.getTime());
  const token = () => decryptToken(config, ownerId, String(connection!._id), connection!.encryptedToken as EncryptedSecret);
  const latestAttempt = () => attempts.findOne({ intentId }, { sort: { attemptNumber: -1 } });

  // ── After the submission barrier: reconcile only ─────────────────────────────────────────────
  if (claimed.submissionBarrier === true) {
    const attempt = await latestAttempt();
    const startedAt = attempt?.requestStartedAt instanceof Date ? attempt.requestStartedAt : now;
    if (!attempt?.containerId || !connection?.encryptedToken) {
      return settle("needs_attention", { error: safeError("OUTCOME_UNKNOWN", "We couldn’t confirm whether Instagram published this post. Check your Instagram profile before posting again.", false) }, { nextCheckAt: "" });
    }
    let status;
    try {
      status = await publisher.containerStatus({ containerId: String(attempt.containerId), accessToken: token() });
    } catch {
      status = "UNKNOWN" as const;
    }
    if (status === "PUBLISHED") {
      return settle("needs_attention", { error: safeError("OUTCOME_LIKELY_PUBLISHED", "Instagram reports this post as published, but we couldn’t get its link. Check your Instagram profile.", false) }, { nextCheckAt: "" });
    }
    if (status === "FINISHED" || status === "EXPIRED" || status === "ERROR") {
      // Authoritative: the container was not published. A new post needs the user's explicit retry.
      await attempts.updateOne({ _id: attempt._id }, { $set: { submissionState: "failed_safe", updatedAt: new Date() } });
      return fail("NOT_PUBLISHED", "Instagram didn’t publish this post. You can retry.", true, true);
    }
    if (now.getTime() - startedAt.getTime() > RECONCILE_GIVE_UP_MS) {
      return settle("needs_attention", { error: safeError("OUTCOME_UNKNOWN", "We still can’t confirm whether Instagram published this post. Check your Instagram profile before posting again.", false) }, { nextCheckAt: "" });
    }
    return settle("outcome_unknown", { nextCheckAt: new Date(now.getTime() + RECONCILE_MS), error: safeError("OUTCOME_UNKNOWN", "Instagram didn’t confirm the post yet. We’re checking — we won’t post it twice.", false) });
  }

  // ── Before the barrier: recheck everything ─────────────────────────────────────────────────
  const project = await db.collection("projects").findOne({ _id: claimed.projectId as never, ownerId, deletedAt: null }, { projection: { _id: 1 } });
  if (!project) return settle("cancelled", { error: safeError("PROJECT_DELETED", "This project was deleted, so the post was cancelled.", false) }, { nextCheckAt: "" });
  const video = await db.collection("videos").findOne({ _id: payload.videoId as never, ownerId });
  const asset = await db.collection("assets").findOne({ _id: payload.assetId as never, ownerId, state: "ready", sha256: payload.outputHash });
  if (!video || video.state !== "approved" || video.finalApprovalId !== payload.videoApprovalId || video.outputHash !== payload.outputHash || !asset) {
    return fail("VIDEO_NOT_APPROVED", "The approved video is no longer available, so nothing was posted.", false);
  }
  if (!destinationOk) return settle("paused_auth", { error: safeError("RECONNECT_REQUIRED", "Instagram needs to be reconnected (same account) before this can post.", true) }, { nextCheckAt: "" });
  if (now.getTime() > (claimed.retryDeadlineAt as Date).getTime()) {
    return settle("needs_attention", { error: safeError("WINDOW_EXPIRED", "The 15-minute posting window passed before Instagram was ready. Nothing was posted.", true) }, { nextCheckAt: "" });
  }

  let attempt = await latestAttempt();
  // Start a container when there is none for this run (first try, or a retry after a safe failure).
  if (claimed.state !== "processing" || !attempt?.containerId || attempt.submissionState !== "not_started") {
    const origin = mediaPublicOrigin();
    if (!origin) return fail("PUBLISHING_UNAVAILABLE", "Instagram can’t reach the video right now (no public media link). Nothing was posted.");
    const attemptId = newId("pat");
    const at = new Date();
    await attempts.insertOne({
      _id: attemptId as never,
      schemaVersion: 1,
      ownerId,
      projectId: claimed.projectId,
      intentId,
      payloadId: String(payload._id),
      attemptNumber: (attempt ? Number(attempt.attemptNumber) : 0) + 1,
      fence: Long.fromNumber(at.getTime()),
      phase: "container",
      submissionState: "not_started",
      createdAt: at,
      updatedAt: at,
    });
    await intents.updateOne(fenced, { $set: { state: "preparing", updatedAt: at } });
    const grant = await createIngestGrant(db, { ownerId, assetId: String(asset._id), projectId: String(claimed.projectId), intentId, attemptId });
    let containerId: string;
    try {
      containerId = await publisher.createReelContainer({ instagramUserId: String(payload.instagramUserId), accessToken: token(), videoUrl: `${origin}${grant.url}`, caption: String(payload.caption) });
    } catch (error) {
      const rejected = error instanceof InstagramProviderError && error.code === "PROVIDER_REJECTED";
      return fail(rejected ? "CONTAINER_REJECTED" : "PROVIDER_UNAVAILABLE", rejected ? "Instagram rejected this video or caption. Nothing was posted." : "Instagram couldn’t be reached. Nothing was posted — you can retry.", true);
    }
    await attempts.updateOne({ _id: attemptId as never }, { $set: { containerId, phase: "processing", nextCheckAt: new Date(Date.now() + POLL_MS), updatedAt: new Date() } });
    return settle("processing", { nextCheckAt: new Date(Date.now() + POLL_MS) }, { error: "" });
  }

  // ── Processing: poll the container; publish only when FINISHED ────────────────────────────────
  attempt = attempt!;
  const containerId = String(attempt.containerId);
  let status;
  try {
    status = await publisher.containerStatus({ containerId, accessToken: token() });
  } catch {
    status = "UNKNOWN" as const;
  }
  if (status === "ERROR") return fail("MEDIA_REJECTED", "Instagram couldn’t process this video. Nothing was posted.", true);
  if (status === "EXPIRED") return fail("CONTAINER_EXPIRED", "Instagram’s upload expired before posting. Nothing was posted — you can retry.", true);
  if (status === "PUBLISHED") {
    return settle("needs_attention", { error: safeError("OUTCOME_LIKELY_PUBLISHED", "Instagram reports this post as published, but we couldn’t confirm it. Check your Instagram profile.", false) }, { nextCheckAt: "" });
  }
  if (status !== "FINISHED") {
    if (now.getTime() - (attempt.createdAt as Date).getTime() > PROCESSING_TIMEOUT_MS) return fail("PROCESSING_TIMEOUT", "Instagram took too long to process the video. Nothing was posted — you can retry.", true);
    return settle("processing", { nextCheckAt: new Date(now.getTime() + POLL_MS) });
  }

  // Barrier: persisted before the only call that can publish.
  const startedAt = new Date();
  const barrier = await intents.updateOne({ ...fenced, submissionBarrier: false }, { $set: { state: "submitting", submissionBarrier: true, updatedAt: startedAt } });
  if (barrier.modifiedCount !== 1) return "skipped";
  await attempts.updateOne({ _id: attempt._id }, { $set: { phase: "publish", submissionState: "request_started", requestStartedAt: startedAt, updatedAt: startedAt } });
  let mediaId: string;
  try {
    mediaId = await publisher.publishContainer({ instagramUserId: String(payload.instagramUserId), accessToken: token(), containerId });
  } catch (error) {
    if (error instanceof InstagramProviderError && error.code === "PROVIDER_REJECTED") {
      // A definite rejection; confirm from the container before allowing a safe retry.
      let after;
      try {
        after = await publisher.containerStatus({ containerId, accessToken: token() });
      } catch {
        after = "UNKNOWN" as const;
      }
      if (after === "FINISHED" || after === "ERROR" || after === "EXPIRED") {
        await attempts.updateOne({ _id: attempt._id }, { $set: { submissionState: "failed_safe", updatedAt: new Date() } });
        return fail("PUBLISH_REJECTED", "Instagram refused to publish this post (for example a daily limit). Nothing was posted — you can retry.", true, true);
      }
    }
    await attempts.updateOne({ _id: attempt._id }, { $set: { submissionState: "outcome_unknown", phase: "reconcile", nextCheckAt: new Date(Date.now() + RECONCILE_MS), updatedAt: new Date() } });
    return settle("outcome_unknown", { nextCheckAt: new Date(Date.now() + RECONCILE_MS), error: safeError("OUTCOME_UNKNOWN", "Instagram didn’t confirm the post yet. We’re checking — we won’t post it twice.", false) });
  }
  let permalink: string | null = null;
  try {
    permalink = await publisher.permalink({ mediaId, accessToken: token() });
  } catch {
    // Published without a recoverable link is still published.
  }
  const confirmedAt = new Date();
  await attempts.updateOne({ _id: attempt._id }, { $set: { submissionState: "confirmed", providerMediaId: mediaId, ...(permalink ? { permalink } : {}), updatedAt: confirmedAt } });
  return settle("published", { publishedAt: confirmedAt, providerMediaId: mediaId, ...(permalink ? { permalink } : {}) }, { error: "", nextCheckAt: "" });
}

/** Cron scan: due queued intents, processing/unknown checks that are due, and stale claims. */
export async function advanceDueIntents(db: Db, deps: Deps = {}, limit = 20) {
  const now = new Date();
  const due = await db
    .collection("publishIntents")
    .find(
      {
        $or: [
          { state: "queued", dueAt: { $lte: now } },
          { state: { $in: ["processing", "outcome_unknown"] }, nextCheckAt: { $lte: now } },
          { state: { $in: ["claimed", "preparing", "submitting"] }, "claim.until": { $lt: now } },
        ],
      },
      { projection: { _id: 1 } },
    )
    .limit(limit)
    .toArray();
  const results: Record<string, number> = {};
  for (const { _id } of due) {
    const outcome = await advancePublish(db, String(_id), deps);
    results[outcome] = (results[outcome] ?? 0) + 1;
  }
  return results;
}
