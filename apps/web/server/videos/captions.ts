import { MongoServerError, type Db } from "mongodb";
import { z } from "zod";
import { canonicalJson, sha256Hex } from "../../lib/canonical";
import { findReceipt, insertReceipt, type CommandIdentity } from "../commands";
import { newId } from "../db/migrations";
import type { Caption, Timeline } from "../generation/compile";
import { buildRenderSpec, type VoiceConfig } from "../generation/spec";
import { GENERATION_DEADLINE_MS, type AcceptedOperation, type GenerationSnapshot } from "../generation/service";
import { ApiError, notFound } from "../http";
import { idRegex, inTransaction, recoverExpiredJob, type JobContext } from "../jobs/core";
import type { ObjectStore } from "../media/object-store";
import { isVoiceAvailable } from "../voices";

// Caption corrections (API_DESIGN.md V03/V04, SYSTEM_DESIGN.md caption rules). Display text changes create a new
// video that reuses the approved storyboard, story approval, voice and recorded speech; only the captions differ,
// so the new render spec hash differs and the new video needs its own final approval. Edits that could change the
// meaning are refused and the user is sent to revise the narration in the storyboard.

export const MAX_CAPTION_CHARS = 54;

export type CaptionLine = { id: string; sourceStart: number; sourceEnd: number; text: string; startFrame: number; endFrame: number };
export type CaptionsView = { videoId: string; renderSpecHash: string; scenes: { sceneId: string; speechFingerprint: string; captions: CaptionLine[] }[] };
export type StoredOverride = { sceneId: string; speechFingerprint: string; sourceStart: number; sourceEnd: number; displayText: string };

async function readJson(store: ObjectStore, key: string) {
  const object = await store.get(key);
  if (!object) throw new ApiError(422, "VIDEO_NOT_READY", "This video’s caption data is missing. Regenerate the video.");
  return JSON.parse(Buffer.from(await new Response(object.stream).arrayBuffer()).toString("utf8"));
}

async function loadVideo(db: Db, ownerId: string, videoId: string) {
  if (!idRegex.test(videoId)) throw notFound();
  const video = await db.collection("videos").findOne({ _id: videoId as never, ownerId });
  if (!video) throw notFound();
  const project = await db.collection("projects").findOne({ _id: video.projectId, ownerId, deletedAt: null }, { projection: { _id: 1 } });
  if (!project) throw notFound();
  return video;
}

/** V03: caption lines per scene with code-point source spans in the approved narration and local frames. */
export async function getCaptions(db: Db, store: ObjectStore, ownerId: string, videoId: string): Promise<CaptionsView> {
  const video = await loadVideo(db, ownerId, videoId);
  if (!["ready_for_review", "approved"].includes(video.state) || !video.timelineAssetId) throw new ApiError(422, "VIDEO_NOT_READY", "Captions are available once the video is ready.");
  const asset = await db.collection("assets").findOne({ _id: video.timelineAssetId, ownerId, state: "ready" });
  const job = await db.collection("jobs").findOne({ ownerId, type: { $in: ["generation", "caption_render"] }, "inputSnapshot.videoId": videoId }, { projection: { "inputSnapshot.scenes": 1 } });
  if (!asset || !job) throw new ApiError(422, "VIDEO_NOT_READY", "This video’s caption data is missing. Regenerate the video.");
  const { timeline } = (await readJson(store, asset.objectKey)) as { timeline: Timeline };
  const fingerprints = new Map((job.inputSnapshot.scenes as GenerationSnapshot["scenes"]).map((s) => [s.id, s.fingerprint]));
  return {
    videoId,
    renderSpecHash: video.renderSpecHash,
    scenes: timeline.scenes.map((scene) => ({
      sceneId: scene.id,
      speechFingerprint: fingerprints.get(scene.id) ?? "",
      captions: scene.captions.map((c: Caption, i) => ({ id: `${scene.id}:${i}`, sourceStart: c.sourceStart, sourceEnd: c.sourceEnd, text: c.text, startFrame: c.start, endFrame: c.end })),
    })),
  };
}

const normalize = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();

function editDistance(a: string, b: string): number {
  const x = [...a];
  const y = [...b];
  let prev = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const row = [i];
    for (let j = 1; j <= y.length; j++) row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    prev = row;
  }
  return prev[y.length];
}

/**
 * Conservative, deterministic meaning guard: punctuation, casing and small spelling fixes are allowed; changing any
 * number, adding/removing more than one word or rewriting more than ~20% of the letters is treated as a narration
 * change. (An AI classifier is deliberately not the authority here.)
 */
export function captionEditAllowed(original: string, display: string): boolean {
  const a = normalize(original);
  const b = normalize(display);
  if (a === b) return true;
  const digits = (s: string) => (s.match(/\p{N}+/gu) ?? []).join(",");
  if (digits(a) !== digits(b)) return false;
  const words = (s: string) => (s ? s.split(" ").length : 0);
  if (Math.abs(words(a) - words(b)) > 1) return false;
  return editDistance(a, b) <= Math.max(2, Math.floor([...a].length * 0.2));
}

const override = z.strictObject({
  sceneId: z.string().regex(/^[a-z][a-z0-9-]{0,49}$/),
  speechFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  sourceStart: z.number().int().min(0),
  sourceEnd: z.number().int().min(1),
  displayText: z.string().max(200),
});
export const captionsBody = z.strictObject({ expectedRenderSpecHash: z.string().regex(/^[a-f0-9]{64}$/), overrides: z.array(override).min(1).max(100) });

/** V04: validates corrections against the current caption lines and starts a new video with the same speech. */
export async function acceptCaptionRevision(
  ctx: JobContext,
  store: ObjectStore,
  identity: CommandIdentity,
  videoId: string,
  body: z.infer<typeof captionsBody>,
): Promise<{ operation: AcceptedOperation; replayed: boolean }> {
  const { db, client } = ctx;
  const { ownerId } = identity;
  const op = (jobId: string, newVideoId: string): AcceptedOperation => ({ jobId, resource: { kind: "video", id: newVideoId }, state: "queued", statusUrl: `/api/jobs/${jobId}` });
  const prior = await findReceipt(db, identity);
  if (prior) return { operation: op(String(prior.responseBody.jobId), String(prior.responseBody.videoId)), replayed: true };

  const source = await loadVideo(db, ownerId, videoId);
  if (source.renderSpecHash !== body.expectedRenderSpecHash) throw new ApiError(409, "SOURCE_CHANGED", "This video changed. Reload it before editing captions.");
  const current = await getCaptions(db, store, ownerId, videoId);
  const storyboard = await db.collection("storyboards").findOne({ _id: source.storyboardId, ownerId });
  if (!storyboard) throw notFound();
  const narration = new Map((storyboard.content.scenes as { id: string; narration: string }[]).map((s) => [s.id, s.narration]));

  const fieldErrors: { path: string; code: string; message: string }[] = [];
  const meaning: string[] = [];
  const seen = new Set<string>();
  body.overrides.forEach((o, i) => {
    const scene = current.scenes.find((s) => s.sceneId === o.sceneId);
    const line = scene?.captions.find((c) => c.sourceStart === o.sourceStart && c.sourceEnd === o.sourceEnd);
    const path = `overrides.${i}`;
    if (!scene || !line) return fieldErrors.push({ path, code: "INVALID_SPAN", message: "This caption line no longer exists." });
    if (scene.speechFingerprint !== o.speechFingerprint) return fieldErrors.push({ path, code: "SOURCE_CHANGED", message: "The narration for this scene changed." });
    const key = `${o.sceneId}:${o.sourceStart}`;
    if (seen.has(key)) return fieldErrors.push({ path, code: "INVALID_SPAN", message: "Each caption line can be corrected once." });
    seen.add(key);
    const text = o.displayText.trim();
    if (!text || [...text].length > MAX_CAPTION_CHARS) return fieldErrors.push({ path, code: "TOO_LONG", message: `Caption lines need 1–${MAX_CAPTION_CHARS} characters.` });
    const original = [...(narration.get(o.sceneId) ?? "")].slice(o.sourceStart, o.sourceEnd).join("");
    if (!captionEditAllowed(original, text)) meaning.push(path);
  });
  if (fieldErrors.length) throw new ApiError(422, fieldErrors.some((e) => e.code === "SOURCE_CHANGED") ? "SOURCE_CHANGED" : "INVALID_SPAN", "Some caption corrections don’t match the current captions.", { fieldErrors });
  if (meaning.length) {
    throw new ApiError(422, "CAPTION_MEANING_CHANGE", "Some changes alter what the narration says. Revise the narration in the storyboard instead so the voice matches.", {
      fieldErrors: meaning.map((path) => ({ path, code: "CAPTION_MEANING_CHANGE", message: "Change the narration in the storyboard for this." })),
    });
  }

  // Corrections accumulate: new ones replace the same lines; earlier corrections on other lines are kept.
  const previous = (source.renderSpec.captionOverrides ?? []) as StoredOverride[];
  const merged = [...previous.filter((p) => !body.overrides.some((o) => o.sceneId === p.sceneId && o.sourceStart === p.sourceStart)), ...body.overrides.map((o) => ({ ...o, displayText: o.displayText.trim() }))]
    .filter((o) => {
      const original = [...(narration.get(o.sceneId) ?? "")].slice(o.sourceStart, o.sourceEnd).join("");
      return o.displayText !== original; // a correction back to the original wording removes the override
    })
    .sort((a, b) => a.sceneId.localeCompare(b.sceneId) || a.sourceStart - b.sourceStart);

  const sourceJob = await db.collection("jobs").findOne({ ownerId, type: { $in: ["generation", "caption_render"] }, "inputSnapshot.videoId": videoId });
  if (!sourceJob) throw new ApiError(422, "VIDEO_NOT_READY", "This video can’t be revised. Regenerate it from the storyboard.");
  const voice = source.resolvedVoice as VoiceConfig;
  if (!isVoiceAvailable(voice.preset)) throw new ApiError(422, "VOICE_UNAVAILABLE", "This narrator isn’t available any more. Generate a new video from the storyboard.");

  const jobId = newId("job");
  const newVideoId = newId("vid");
  try {
    await inTransaction(client, async (session) => {
      const now = new Date();
      const project = await db.collection("projects").findOne({ _id: source.projectId, ownerId, deletedAt: null }, { session });
      if (!project) throw notFound();
      if (project.activeJobId) await recoverExpiredJob(db, session, ownerId, String(source.projectId), project.activeJobId, now);
      const { renderSpec, renderSpecHash } = buildRenderSpec({ id: String(source.storyboardId), storyHash: source.renderSpec.storyHash }, voice, merged);
      const snapshot: GenerationSnapshot = { ...(sourceJob.inputSnapshot as GenerationSnapshot), videoId: newVideoId, renderSpecHash, captionOverrides: merged };
      await db.collection("videos").insertOne(
        { _id: newVideoId as never, schemaVersion: 1, ownerId, projectId: source.projectId, storyboardId: source.storyboardId, storyApprovalId: source.storyApprovalId, parentVideoId: videoId, renderSpec, renderSpecHash, state: "building", resolvedVoice: voice, rendererBuildId: renderSpec.rendererBuildId, createdAt: now, updatedAt: now },
        { session },
      );
      await db.collection("jobs").insertOne(
        {
          _id: jobId as never, schemaVersion: 1, ownerId, projectId: source.projectId, type: "caption_render", state: "queued", revision: 1, stage: "queued",
          inputSnapshot: snapshot, inputHash: sha256Hex(canonicalJson({ type: "caption_render", renderSpecHash })), executionAttempt: 1,
          progress: { completedScenes: 0, totalScenes: snapshot.scenes.length }, deadlineAt: new Date(now.getTime() + GENERATION_DEADLINE_MS), activeSlot: true, createdAt: now, updatedAt: now,
        },
        { session },
      );
      const claimed = await db.collection("projects").updateOne(
        { _id: source.projectId, ownerId, deletedAt: null, activeJobId: { $exists: false } },
        { $set: { activeJobId: jobId, updatedAt: now }, $inc: { contentRevision: 1 } },
        { session },
      );
      if (claimed.modifiedCount !== 1) throw new ApiError(409, "PROJECT_BUSY", "Another task is running for this video. Wait for it to finish.");
      await db.collection("outbox").insertOne(
        { _id: newId("obx") as never, schemaVersion: 1, ownerId, projectId: source.projectId, eventId: newId("evt"), aggregateId: jobId, eventType: "job.caption_render.requested", payloadIds: { jobId }, state: "pending", attempts: 0, availableAt: now, createdAt: now, updatedAt: now },
        { session },
      );
      await insertReceipt(db, session, identity, { responseStatus: 202, responseBody: { jobId, videoId: newVideoId }, resourceIds: [jobId, newVideoId], projectId: String(source.projectId) }, now);
    });
  } catch (error) {
    if (error instanceof MongoServerError && error.code === 11000) {
      const winner = await findReceipt(db, identity);
      if (winner) return { operation: op(String(winner.responseBody.jobId), String(winner.responseBody.videoId)), replayed: true };
      throw new ApiError(409, "PROJECT_BUSY", "Another task is running for this video.");
    }
    throw error;
  }
  return { operation: op(jobId, newVideoId), replayed: false };
}
