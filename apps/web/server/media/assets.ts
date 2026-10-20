import { createHash, randomBytes } from "node:crypto";
import { Long, type Db } from "mongodb";
import { z } from "zod";
import { canonicalJson, sha256Hex } from "../../lib/canonical";
import { newId } from "../db/migrations";
import { ApiError, notFound } from "../http";
import { idRegex, inTransaction, type JobContext } from "../jobs/core";
import type { ObjectStore } from "./object-store";

// Private assets and media grants (DB_DESIGN.md sections 5.5, 9.2; SYSTEM_DESIGN.md media gateway).
// Upload happens outside transactions to a server-generated key; readiness commits only after the stored size and
// MD5 (R2 single-part ETag) match, and only while the parent project is live. Browsers never get storage URLs:
// they receive short-lived bearer grants whose hashes are stored and which are re-checked on every request.

export const GRANT_TTL_MS = 10 * 60_000;
export type AssetKind = "audio" | "alignment" | "timeline" | "captions" | "thumbnail" | "preview" | "video" | "qa";
const EXTENSIONS: Record<string, string> = { "audio/mpeg": "mp3", "application/json": "json", "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "video/mp4": "mp4", "text/vtt": "vtt" };

export class StorageUnavailableError extends ApiError {
  constructor() {
    super(503, "INTEGRATION_UNAVAILABLE", "Media storage isn’t available right now.", { retryable: true });
  }
}

export type StoreAssetInput = {
  ownerId: string;
  projectId: string;
  originJobId: string;
  originVideoId?: string;
  kind: AssetKind;
  contentType: keyof typeof EXTENSIONS;
  body: Buffer;
  producerFingerprint: string;
  metadata?: { durationSeconds?: number; width?: number; height?: number; fps?: number; codec?: string };
};

/** Stores bytes as a ready asset, or throws. Leaves no ready record if verification or the parent check fails. */
export async function storeAsset(ctx: JobContext, store: ObjectStore, input: StoreAssetInput): Promise<{ assetId: string; objectKey: string; sha256: string; bytes: number }> {
  const { db, client } = ctx;
  if (!input.body.length) throw new Error("Refusing to store an empty asset");
  const assetId = newId("ast");
  const objectKey = `projects/${input.projectId}/${input.kind}/${assetId}.${EXTENSIONS[input.contentType]}`;
  const sha256 = createHash("sha256").update(input.body).digest("hex");
  const md5 = createHash("md5").update(input.body).digest("hex");
  const now = new Date();
  const project = await db.collection("projects").findOne({ _id: input.projectId as never, ownerId: input.ownerId, deletedAt: null }, { projection: { _id: 1 } });
  if (!project) throw notFound();

  await db.collection("assets").insertOne({
    _id: assetId as never,
    schemaVersion: 1,
    ownerId: input.ownerId,
    projectId: input.projectId,
    kind: input.kind,
    ...(input.originVideoId ? { originVideoId: input.originVideoId } : {}),
    originJobId: input.originJobId,
    objectKey,
    state: "staging",
    contentType: input.contentType,
    producerFingerprint: input.producerFingerprint,
    metadata: input.metadata ?? {},
    createdAt: now,
    updatedAt: now,
  });

  await store.put(objectKey, input.body, input.contentType);
  const stored = await store.head(objectKey);
  if (!stored || stored.bytes !== input.body.length || (stored.etag && stored.etag !== md5)) {
    await store.delete(objectKey).catch(() => undefined);
    await db.collection("assets").updateOne({ _id: assetId as never, state: "staging" }, { $set: { state: "deleted", updatedAt: new Date() } });
    throw new Error("Stored object failed size/integrity verification");
  }

  const committed = await inTransaction(client, async (session) => {
    // Live-parent fence: a project deleted during upload never gains a visible ready asset.
    const parent = await db.collection("projects").updateOne(
      { _id: input.projectId as never, ownerId: input.ownerId, deletedAt: null },
      { $inc: { contentRevision: 1 } },
      { session },
    );
    if (parent.modifiedCount !== 1) return false;
    const ready = new Date();
    await db.collection("assets").updateOne(
      { _id: assetId as never, state: "staging" },
      { $set: { state: "ready", sha256, bytes: Long.fromNumber(input.body.length), readyAt: ready, updatedAt: ready } },
      { session },
    );
    return true;
  });
  if (!committed) {
    await store.delete(objectKey).catch(() => undefined);
    await db.collection("assets").updateOne({ _id: assetId as never }, { $set: { state: "deleted", updatedAt: new Date() } });
    throw notFound();
  }
  return { assetId, objectKey, sha256, bytes: input.body.length };
}

const tokenHash = (token: string) => sha256Hex(`namastevideo:grant:v1:${token}`);

async function insertGrant(
  db: Db,
  grant: { ownerId: string; assetId: string; projectId?: string; purpose: string; intentId?: string; attemptId?: string },
  now = new Date(),
  ttlMs = GRANT_TTL_MS,
) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + ttlMs);
  await db.collection("mediaGrants").insertOne({
    _id: newId("grt") as never,
    schemaVersion: 1,
    ownerId: grant.ownerId,
    ...(grant.projectId ? { projectId: grant.projectId } : {}),
    assetId: grant.assetId,
    tokenHash: tokenHash(token),
    purpose: grant.purpose,
    ...(grant.intentId ? { intentId: grant.intentId } : {}),
    ...(grant.attemptId ? { attemptId: grant.attemptId } : {}),
    expiresAt,
    createdAt: now,
    updatedAt: now,
  });
  return { url: `/api/media/${token}`, expiresAt };
}

/** Meta ingestion: up to 6 hours, scoped to one publish intent/attempt; revoked once the outcome is resolved. */
export const INGEST_GRANT_TTL_MS = 6 * 60 * 60_000;

/** Server-only: a dedicated ingestion grant (relative gateway path) for the publish worker. No creator session needed. */
export async function createIngestGrant(db: Db, grant: { ownerId: string; assetId: string; projectId: string; intentId: string; attemptId: string }) {
  return insertGrant(db, { ...grant, purpose: "ingest" }, new Date(), INGEST_GRANT_TTL_MS);
}

export async function revokeIntentGrants(db: Db, ownerId: string, intentId: string) {
  await db.collection("mediaGrants").updateMany({ ownerId, intentId, revokedAt: { $exists: false } }, { $set: { revokedAt: new Date(), updatedAt: new Date() } });
}

export const accessBody = z.strictObject({ purpose: z.enum(["preview", "download"]) });

/**
 * V06: a short-lived, revocable bearer URL for an owner's ready asset in a live project. The storage object is
 * checked first so a missing file is reported instead of handing out a dead link. Not idempotent by design.
 */
export async function createAccessGrant(db: Db, store: ObjectStore, ownerId: string, assetId: string, purpose: "preview" | "download") {
  if (!idRegex.test(assetId)) throw notFound();
  const asset = await db.collection("assets").findOne({ _id: assetId as never, ownerId });
  if (!asset) throw notFound();
  const project = await db.collection("projects").findOne({ _id: asset.projectId, ownerId, deletedAt: null }, { projection: { _id: 1 } });
  if (!project) throw notFound();
  if (asset.state !== "ready") throw new ApiError(422, "ASSET_NOT_READY", "This media isn’t ready yet.");
  const stored = await store.head(asset.objectKey);
  if (!stored || stored.bytes !== Number(asset.bytes)) {
    throw new ApiError(422, "ASSET_NOT_READY", "This media file is missing. Regenerate it to continue.", { details: { reason: "missing" } });
  }
  const grant = await insertGrant(db, { ownerId, assetId, projectId: asset.projectId, purpose });
  return { url: grant.url, expiresAt: grant.expiresAt.toISOString(), contentType: asset.contentType as string, bytes: Number(asset.bytes) };
}

export type ResolvedMedia = { objectKey: string; contentType: string; bytes: number; download: boolean; filename: string };

/**
 * Gateway authorization for one request: token hash, explicit expiry (TTL is only cleanup), revocation, readiness,
 * same-owner live project, or an enabled catalog voice sample. Any failure is an indistinguishable null.
 */
export async function resolveGrant(db: Db, token: string, now = new Date()): Promise<ResolvedMedia | null> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const grant = await db.collection("mediaGrants").findOne({ tokenHash: tokenHash(token) });
  if (!grant || grant.revokedAt || grant.expiresAt <= now) return null;
  if (grant.purpose === "voice_sample") {
    const sample = await db.collection("voiceSamples").findOne({ _id: grant.assetId, enabled: true });
    if (!sample) return null;
    return { objectKey: sample.objectKey, contentType: sample.contentType, bytes: Number(sample.bytes), download: false, filename: `${sample.preset}.mp3` };
  }
  const asset = await db.collection("assets").findOne({ _id: grant.assetId, ownerId: grant.ownerId, state: "ready" });
  if (!asset || asset.projectId !== grant.projectId) return null;
  const project = await db.collection("projects").findOne({ _id: asset.projectId, ownerId: grant.ownerId, deletedAt: null }, { projection: { _id: 1 } });
  if (!project) return null;
  return {
    objectKey: asset.objectKey,
    contentType: asset.contentType,
    bytes: Number(asset.bytes),
    download: grant.purpose === "download",
    filename: `namastevideo-${asset.kind}-${String(asset._id).slice(4, 12)}.${EXTENSIONS[asset.contentType] ?? "bin"}`,
  };
}

/** Revokes every grant of a project (used by deletion cleanup; the gateway already denies tombstoned projects). */
export async function revokeProjectGrants(db: Db, ownerId: string, projectId: string) {
  const now = new Date();
  await db.collection("mediaGrants").updateMany({ ownerId, projectId, revokedAt: { $exists: false } }, { $set: { revokedAt: now, updatedAt: now } });
}

/** Parses a single HTTP byte range. Returns "unsatisfiable" for ranges outside the object; null for no/ignored header. */
export function parseRange(header: string | null, size: number): { start: number; end: number } | "unsatisfiable" | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (match[1] === "" && match[2] === "")) return null; // multi-range or malformed: serve the full body
  if (match[1] === "") {
    const suffix = Number(match[2]);
    if (suffix === 0) return "unsatisfiable";
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(match[1]);
  const end = match[2] === "" ? size - 1 : Math.min(Number(match[2]), size - 1);
  if (start >= size || end < start) return "unsatisfiable";
  return { start, end };
}

// ---- Voice sample catalog (service-managed, outside user projects) ------------------------------------------------

export async function storeVoiceSample(db: Db, store: ObjectStore, input: { preset: string; audio: Buffer; configuration: Record<string, unknown> }) {
  const voiceConfigurationHash = sha256Hex(canonicalJson(input.configuration));
  const sha256 = createHash("sha256").update(input.audio).digest("hex");
  const objectKey = `catalog/voice-samples/${input.preset}/${sha256}.mp3`;
  await store.put(objectKey, input.audio, "audio/mpeg");
  const stored = await store.head(objectKey);
  if (!stored || stored.bytes !== input.audio.length || (stored.etag && stored.etag !== createHash("md5").update(input.audio).digest("hex"))) {
    throw new Error("Stored voice sample failed verification");
  }
  const now = new Date();
  // Only one enabled sample per preset; the new configuration replaces older ones.
  await db.collection("voiceSamples").updateMany({ preset: input.preset, voiceConfigurationHash: { $ne: voiceConfigurationHash } }, { $set: { enabled: false, updatedAt: now } });
  await db.collection("voiceSamples").updateOne(
    { preset: input.preset, voiceConfigurationHash },
    {
      $set: { objectKey, sha256, bytes: Long.fromNumber(input.audio.length), contentType: "audio/mpeg", enabled: true, updatedAt: now },
      $setOnInsert: { _id: newId("vcs") as never, schemaVersion: 1, preset: input.preset, voiceConfigurationHash, createdAt: now },
    },
    { upsert: true },
  );
  return { objectKey, sha256, bytes: input.audio.length };
}

export async function enabledVoiceSamples(db: Db): Promise<Set<string>> {
  const samples = await db.collection("voiceSamples").find({ enabled: true }, { projection: { preset: 1 } }).toArray();
  return new Set(samples.map((s) => String(s.preset)));
}

/** A short-lived grant for a catalog sample, owned by the requesting user and outside any project. */
export async function voiceSampleGrant(db: Db, ownerId: string, preset: string): Promise<string | null> {
  const sample = await db.collection("voiceSamples").findOne({ preset, enabled: true }, { projection: { _id: 1 } });
  if (!sample) return null;
  return (await insertGrant(db, { ownerId, assetId: String(sample._id), purpose: "voice_sample" })).url;
}
