import { Long, MongoServerError, type ClientSession, type Db, type MongoClient, type TransactionOptions } from "mongodb";
import { z } from "zod";
import { canonicalJson, sha256Hex } from "../../lib/canonical";
import { commandIdentity, findReceipt, insertReceipt, type CommandIdentity } from "../commands";
import { decodeCursor, encodeCursor } from "../cursor";
import { ID_PATTERN } from "../db/schema";
import { newId } from "../db/migrations";
import { ApiError, notFound } from "../http";
import { DEFAULT_VOICE_PRESET, isVoiceAvailable } from "../voices";
import { draftContentHash, draftIssues } from "../drafts/rules";

// Personal projects (API_DESIGN.md P01-P05, DB_DESIGN.md T01/T17). Every query is scoped by the session owner;
// foreign, malformed and deleted IDs are indistinguishable (404).

export const DEFAULT_TITLE = "Untitled video";
const CLEANUP_DEADLINE_MS = 7 * 24 * 60 * 60_000;
const TXN: TransactionOptions = { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" }, readPreference: "primary" };
const idRegex = new RegExp(ID_PATTERN);

export type ProjectsContext = { db: Db; client: MongoClient; cursorSecret: string };

const FLAG_FIELDS = { drafts: "drafts", ready: "ready", scheduled: "scheduled", published: "published", needs_attention: "needsAttention" } as const;
export type ProjectFilter = "all" | keyof typeof FLAG_FIELDS;

type Flags = { drafts: boolean; ready: boolean; scheduled: boolean; published: boolean; needsAttention: boolean };
type ProjectDoc = {
  _id: string;
  ownerId: string;
  title: string;
  revision: number;
  draftRevision: number;
  conversationId: string;
  currentStoryboardId?: string;
  latestReadyVideoId?: string;
  selectedVideoId?: string;
  activeJobId?: string;
  deletedAt: Date | null;
  flags: Flags;
  createdAt: Date;
  updatedAt: Date;
};

export type ProjectView = {
  id: string;
  title: string;
  revision: number;
  draftRevision: number;
  conversationId: string;
  currentStoryboardId: string | null;
  latestReadyVideoId: string | null;
  selectedVideoId: string | null;
  activeJobId: string | null;
  flags: Flags;
  createdAt: string;
  updatedAt: string;
};

export function toProjectView(doc: ProjectDoc): ProjectView {
  return {
    id: doc._id,
    title: doc.title,
    revision: doc.revision,
    draftRevision: doc.draftRevision,
    conversationId: doc.conversationId,
    currentStoryboardId: doc.currentStoryboardId ?? null,
    latestReadyVideoId: doc.latestReadyVideoId ?? null,
    selectedVideoId: doc.selectedVideoId ?? null,
    activeJobId: doc.activeJobId ?? null,
    flags: { ...doc.flags },
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

// Titles are trimmed and counted in Unicode code points (API_DESIGN.md section 2.1).
const title = z
  .string()
  .transform((value) => value.trim())
  .refine((value) => [...value].length >= 1 && [...value].length <= 100, { message: "Use 1 to 100 characters." });
const revision = z.number().int().min(1);

export const createProjectBody = z.strictObject({ title: title.optional() });
export const updateProjectBody = z
  .strictObject({ expectedRevision: revision, title: title.optional(), selectedVideoId: z.string().regex(idRegex).optional() })
  .refine((body) => body.title !== undefined || body.selectedVideoId !== undefined, { message: "Change at least one field." });
export const deleteProjectBody = z.strictObject({ expectedRevision: revision, confirm: z.literal(true) });

export const listQuery = z.strictObject({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().max(2048).optional(),
  filter: z.enum(["all", "drafts", "ready", "scheduled", "published", "needs_attention"]).default("all"),
});

const projects = (db: Db) => db.collection<ProjectDoc>("projects");
const isDuplicateKey = (error: unknown) => error instanceof MongoServerError && error.code === 11000;

async function inTransaction<T>(client: MongoClient, run: (session: ClientSession) => Promise<T>): Promise<T> {
  const session = client.startSession();
  try {
    return await session.withTransaction(() => run(session), TXN);
  } finally {
    await session.endSession();
  }
}

function revisionConflict(currentRevision: number, projectId: string) {
  return new ApiError(409, "REVISION_CONFLICT", "This project changed in another tab. Reload it and try again.", {
    details: { currentRevision, reloadUrl: `/api/projects/${projectId}` },
  });
}

export async function getProject(db: Db, ownerId: string, projectId: string): Promise<ProjectView | null> {
  if (!idRegex.test(projectId)) return null;
  const doc = await projects(db).findOne({ _id: projectId, ownerId, deletedAt: null });
  return doc ? toProjectView(doc) : null;
}

export async function listProjects(
  { db, cursorSecret }: ProjectsContext,
  ownerId: string,
  query: z.infer<typeof listQuery>,
): Promise<{ items: ProjectView[]; nextCursor: string | null; hasMore: boolean }> {
  const binding = { ownerId, route: "projects", filter: query.filter };
  const filter: Record<string, unknown> = { ownerId, deletedAt: null };
  if (query.filter !== "all") filter[`flags.${FLAG_FIELDS[query.filter]}`] = true;
  if (query.cursor) {
    const position = decodeCursor(cursorSecret, binding, query.cursor);
    const at = new Date(position.sortMs);
    filter.$or = [{ updatedAt: { $lt: at } }, { updatedAt: at, _id: { $lt: position.id } }];
  }
  const docs = await projects(db).find(filter).sort({ updatedAt: -1, _id: -1 }).limit(query.limit + 1).toArray();
  const hasMore = docs.length > query.limit;
  const page = docs.slice(0, query.limit);
  const last = page.at(-1);
  return {
    items: page.map(toProjectView),
    hasMore,
    nextCursor: hasMore && last ? encodeCursor(cursorSecret, binding, { sortMs: last.updatedAt.getTime(), id: last._id }) : null,
  };
}

/** T01: receipt + project + blank draft + conversation commit together. Replays return the original project ID. */
export async function createProject(
  { db, client }: ProjectsContext,
  identity: CommandIdentity,
  body: z.infer<typeof createProjectBody>,
): Promise<{ projectId: string; replayed: boolean }> {
  const prior = await findReceipt(db, identity);
  if (prior) return { projectId: prior.resourceIds[0], replayed: true };

  const { ownerId } = identity;
  const now = new Date();
  const projectId = newId("prj");
  const conversationId = newId("cnv");
  const preferences = await db.collection("preferences").findOne({ ownerId });
  // Snapshot of the personal default at creation; a voice that was later removed falls back to the default preset.
  const voicePreset = typeof preferences?.defaultVoicePreset === "string" && isVoiceAvailable(preferences.defaultVoicePreset) ? preferences.defaultVoicePreset : DEFAULT_VOICE_PRESET;
  const blank = { topic: "", audience: "", notes: "", voicePreset, editablePlan: null };

  try {
    await inTransaction(client, async (session) => {
      await insertReceipt(db, session, identity, { responseStatus: 201, responseBody: { projectId }, resourceIds: [projectId], projectId }, now);
      await projects(db).insertOne(
        {
          _id: projectId,
          schemaVersion: 1,
          ownerId,
          title: body.title ?? DEFAULT_TITLE,
          revision: 1,
          draftRevision: 1,
          conversationId,
          deletedAt: null,
          flags: { drafts: true, ready: false, scheduled: false, published: false, needsAttention: false },
          contentRevision: Long.fromNumber(1),
          createdAt: now,
          updatedAt: now,
        } as ProjectDoc,
        { session },
      );
      await db.collection("drafts").insertOne(
        {
          _id: newId("drf") as never,
          schemaVersion: 1,
          ownerId,
          projectId,
          revision: 1,
          ...blank,
          planStale: false,
          contentHash: draftContentHash(blank),
          canonicalizationVersion: 1,
          validationIssues: draftIssues(blank),
          createdAt: now,
          updatedAt: now,
        },
        { session },
      );
      await db.collection("conversations").insertOne(
        { _id: conversationId as never, schemaVersion: 1, ownerId, projectId, kind: "project", nextSequence: Long.fromNumber(1), createdAt: now, updatedAt: now },
        { session },
      );
    });
  } catch (error) {
    // A concurrent request with the same key committed first: replay its receipt.
    const winner = isDuplicateKey(error) ? await findReceipt(db, identity) : null;
    if (winner) return { projectId: winner.resourceIds[0], replayed: true };
    throw error;
  }
  return { projectId, replayed: false };
}

/** P04: metadata CAS on the project's revision. Selecting a video requires a ready/approved video of this project. */
export async function updateProject(
  { db, client }: ProjectsContext,
  ownerId: string,
  projectId: string,
  body: z.infer<typeof updateProjectBody>,
): Promise<ProjectView> {
  if (!idRegex.test(projectId)) throw notFound();
  const now = new Date();
  return inTransaction(client, async (session) => {
    if (body.selectedVideoId) {
      const video = await db.collection("videos").findOne(
        { _id: body.selectedVideoId as never, ownerId, projectId, state: { $in: ["ready_for_review", "approved"] } },
        { session, projection: { _id: 1 } },
      );
      if (!video) throw new ApiError(422, "VIDEO_NOT_READY", "That video isn’t ready to select.");
    }
    const updated = await projects(db).findOneAndUpdate(
      { _id: projectId, ownerId, deletedAt: null, revision: body.expectedRevision },
      {
        $set: { ...(body.title !== undefined ? { title: body.title } : {}), ...(body.selectedVideoId ? { selectedVideoId: body.selectedVideoId } : {}), updatedAt: now },
        $inc: { revision: 1 },
      },
      { session, returnDocument: "after" },
    );
    if (updated) return toProjectView(updated);
    const current = await projects(db).findOne({ _id: projectId, ownerId, deletedAt: null }, { session, projection: { revision: 1 } });
    if (!current) throw notFound();
    throw revisionConflict(current.revision, projectId);
  });
}

export type AcceptedOperation = { jobId: string; resource: { kind: "project"; id: string }; state: "queued"; statusUrl: string };

/**
 * T17: tombstone the project (content access ends at acceptance), cancel queued work and unsubmitted publishing,
 * and queue a cleanup job + outbox event with the receipt. Physical cleanup is performed by the job worker (F13).
 */
export async function deleteProject(
  { db, client }: ProjectsContext,
  identity: CommandIdentity,
  projectId: string,
  body: z.infer<typeof deleteProjectBody>,
): Promise<{ operation: AcceptedOperation; replayed: boolean }> {
  const operationFor = (jobId: string): AcceptedOperation => ({ jobId, resource: { kind: "project", id: projectId }, state: "queued", statusUrl: `/api/jobs/${jobId}` });
  if (!idRegex.test(projectId)) throw notFound();
  // The owner's own deletion receipt stays replayable after the tombstone.
  const prior = await findReceipt(db, identity);
  if (prior) return { operation: operationFor(String(prior.responseBody.jobId)), replayed: true };

  const { ownerId } = identity;
  const now = new Date();
  const jobId = newId("job");
  try {
    await inTransaction(client, async (session) => {
      const project = await projects(db).findOneAndUpdate(
        { _id: projectId, ownerId, deletedAt: null, revision: body.expectedRevision },
        { $set: { deletedAt: now, updatedAt: now }, $inc: { revision: 1, contentRevision: 1 } },
        { session, returnDocument: "before" },
      );
      if (!project) {
        const current = await projects(db).findOne({ _id: projectId, ownerId, deletedAt: null }, { session, projection: { revision: 1 } });
        if (!current) throw notFound();
        throw revisionConflict(current.revision, projectId);
      }

      const jobs = db.collection("jobs");
      await jobs.updateMany(
        { ownerId, projectId, type: { $ne: "cleanup" }, state: "queued" },
        { $set: { state: "cancelled", finishedAt: now, updatedAt: now }, $unset: { activeSlot: "" }, $inc: { revision: 1 } },
        { session },
      );
      await jobs.updateMany(
        { ownerId, projectId, type: { $ne: "cleanup" }, state: "running" },
        { $set: { state: "cancel_requested", cancellationRequestedAt: now, updatedAt: now }, $inc: { revision: 1 } },
        { session },
      );
      // Unclaimed, unsubmitted delivery is cancelled; anything past the submission barrier is left for reconciliation.
      await db.collection("publishIntents").updateMany(
        {
          ownerId,
          projectId,
          state: { $in: ["scheduled", "queued", "paused_auth", "failed_safe", "needs_attention"] },
          submissionBarrier: false,
          claim: { $exists: false },
        },
        { $set: { state: "cancelled", unresolved: false, updatedAt: now }, $inc: { revision: 1 } },
        { session },
      );

      await jobs.insertOne(
        {
          _id: jobId as never,
          schemaVersion: 1,
          ownerId,
          projectId,
          type: "cleanup",
          state: "queued",
          revision: 1,
          stage: "cleanup",
          inputSnapshot: { projectId, requestedAt: now },
          inputHash: sha256Hex(canonicalJson({ type: "cleanup", projectId })),
          executionAttempt: 1,
          progress: {},
          deadlineAt: new Date(now.getTime() + CLEANUP_DEADLINE_MS),
          createdAt: now,
          updatedAt: now,
        },
        { session },
      );
      await db.collection("outbox").insertOne(
        {
          _id: newId("obx") as never,
          schemaVersion: 1,
          ownerId,
          projectId,
          eventId: newId("evt"),
          aggregateId: projectId,
          eventType: "project.cleanup_requested",
          payloadIds: { jobId },
          state: "pending",
          attempts: 0,
          availableAt: now,
          createdAt: now,
          updatedAt: now,
        },
        { session },
      );
      await insertReceipt(db, session, identity, { responseStatus: 202, responseBody: { jobId }, resourceIds: [jobId, projectId], projectId }, now);
    });
  } catch (error) {
    const winner = isDuplicateKey(error) ? await findReceipt(db, identity) : null;
    if (winner) return { operation: operationFor(String(winner.responseBody.jobId)), replayed: true };
    throw error;
  }
  return { operation: operationFor(jobId), replayed: false };
}

export type JobView = {
  id: string;
  projectId: string;
  type: string;
  state: string;
  stage: string;
  revision: number;
  attempt: number;
  progress: { completedScenes: number | null; totalScenes: number | null; renderPercent: number | null };
  result: unknown;
  error: { code: string; message: string; retryable: boolean; correlationId: string } | null;
  inputRequest: unknown;
  actions: { cancel: boolean; retry: boolean; regenerate: boolean };
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
};

/** G02 (minimal): owner-scoped job status. After deletion only the project's cleanup job remains visible. */
export async function getJob(db: Db, ownerId: string, jobId: string): Promise<JobView | null> {
  if (!idRegex.test(jobId)) return null;
  const job = await db.collection("jobs").findOne({ _id: jobId as never, ownerId });
  if (!job) return null;
  const project = await projects(db).findOne({ _id: job.projectId, ownerId }, { projection: { deletedAt: 1 } });
  if (job.type !== "cleanup" && (!project || project.deletedAt !== null)) return null;
  return {
    id: String(job._id),
    projectId: job.projectId,
    type: job.type,
    state: job.state,
    stage: job.stage,
    revision: job.revision,
    attempt: job.executionAttempt,
    progress: {
      completedScenes: job.progress?.completedScenes ?? null,
      totalScenes: job.progress?.totalScenes ?? null,
      renderPercent: job.progress?.renderPercent ?? null,
    },
    // Cleanup status omits deleted content; other job results arrive with their features.
    result: job.result ?? null,
    error: job.error ? { code: job.error.code, message: job.error.message, retryable: job.error.retryable, correlationId: job.error.correlationId } : null,
    inputRequest: null,
    // Server-computed hints only; every action re-checks state. Cleanup can't be cancelled.
    actions: {
      cancel: job.type !== "cleanup" && ["queued", "running"].includes(job.state),
      retry: ["generation", "caption_render"].includes(job.type) && job.state === "failed" && job.error?.retryable !== false,
      regenerate: false,
    },
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
    finishedAt: job.finishedAt ? job.finishedAt.toISOString() : null,
  };
}

export { commandIdentity };
