import { Long, MongoServerError, type ClientSession, type Db, type Document, type MongoClient, type TransactionOptions } from "mongodb";
import { canonicalJson, sha256Hex } from "../../lib/canonical";
import { findReceipt, insertReceipt, type CommandIdentity } from "../commands";
import { ID_PATTERN } from "../db/schema";
import { newId } from "../db/migrations";
import { ProviderError } from "../ai/gemini";
import { ApiError, notFound } from "../http";

// Content-pipeline job lifecycle shared by AI commands (DB_DESIGN.md T03/T04, section 9.1).
// Acceptance: live parent + single content slot + draft revision CAS + frozen snapshot + user message + outbox +
// receipt in one transaction. Execution: atomic queued → running claim, so the interim in-process runner and the
// durable worker (F13) can never both execute a job. Completion writes results and releases the slot only if the
// slot still belongs to the job; a project deleted mid-run yields `cancelled` with nothing visible.

const TXN: TransactionOptions = { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" }, readPreference: "primary" };
export const idRegex = new RegExp(ID_PATTERN);

export type JobContext = { db: Db; client: MongoClient };
export type SafeError = { code: string; message: string; retryable: boolean; correlationId: string };

export async function inTransaction<T>(client: MongoClient, run: (session: ClientSession) => Promise<T>): Promise<T> {
  const session = client.startSession();
  try {
    return await session.withTransaction(() => run(session), TXN);
  } finally {
    await session.endSession();
  }
}

export async function appendMessage(
  db: Db,
  session: ClientSession,
  m: { ownerId: string; projectId: string; conversationId: string; role: "user" | "assistant"; text: string; jobId: string; messageKey: string; sourceStoryboardId?: string },
  now: Date,
) {
  const conversation = await db.collection("conversations").findOneAndUpdate(
    { _id: m.conversationId as never, ownerId: m.ownerId, projectId: m.projectId },
    { $inc: { nextSequence: 1 }, $set: { updatedAt: now } },
    { session, returnDocument: "before" },
  );
  if (!conversation) throw new Error("Project conversation is missing");
  await db.collection("messages").insertOne(
    {
      _id: newId("msg") as never,
      schemaVersion: 1,
      ownerId: m.ownerId,
      projectId: m.projectId,
      conversationId: m.conversationId,
      sequence: Long.fromValue(conversation.nextSequence),
      operationId: m.jobId,
      role: m.role,
      text: [...m.text].slice(0, 12000).join(""),
      messageKey: m.messageKey,
      ...(m.sourceStoryboardId ? { sourceStoryboardId: m.sourceStoryboardId } : {}),
      createdAt: now,
      updatedAt: now,
    },
    { session },
  );
}

/** An expired, non-terminal job (e.g. the server stopped mid-run) is failed so it no longer blocks the project. */
export async function recoverExpiredJob(db: Db, session: ClientSession, ownerId: string, projectId: string, jobId: string, now: Date) {
  const expired = await db.collection("jobs").updateOne(
    { _id: jobId as never, ownerId, projectId, state: { $in: ["queued", "running"] }, deadlineAt: { $lt: now } },
    {
      $set: {
        state: "failed",
        error: { code: "PROVIDER_OUTCOME_UNKNOWN", message: "This task didn’t finish in time.", retryable: true, correlationId: newId("cor") },
        finishedAt: now,
        updatedAt: now,
      },
      $unset: { activeSlot: "" },
      $inc: { revision: 1 },
    },
    { session },
  );
  const terminal = await db.collection("jobs").findOne({ _id: jobId as never, state: { $nin: ["queued", "running", "cancel_requested"] } }, { session, projection: { _id: 1 } });
  if (expired.modifiedCount === 1 || terminal) {
    await db.collection("projects").updateOne({ _id: projectId as never, ownerId, activeJobId: jobId }, { $unset: { activeJobId: "" } }, { session });
  }
}

export type AcceptOptions = {
  type: "brainstorm" | "storyboard" | "revision";
  stage: "planning";
  expectedDraftRevision: number;
  deadlineMs: number;
  eventType: string;
  /** Validates the saved draft (throw ApiError to reject) and returns the frozen input snapshot. */
  snapshot: (draft: Document, session: ClientSession) => Record<string, unknown> | Promise<Record<string, unknown>>;
  userMessage: string;
};

export async function acceptJob(
  { db, client }: JobContext,
  identity: CommandIdentity,
  projectId: string,
  options: AcceptOptions,
): Promise<{ jobId: string; replayed: boolean }> {
  if (!idRegex.test(projectId)) throw notFound();
  const prior = await findReceipt(db, identity);
  if (prior) return { jobId: String(prior.responseBody.jobId), replayed: true };

  const { ownerId } = identity;
  const now = new Date();
  const jobId = newId("job");
  const busy = (activeJobId?: string) =>
    new ApiError(409, "PROJECT_BUSY", "Another AI task is still running for this video. Wait for it to finish.", activeJobId ? { details: { activeJobId } } : {});
  try {
    await inTransaction(client, async (session) => {
      const project = await db.collection("projects").findOne({ _id: projectId as never, ownerId, deletedAt: null }, { session });
      if (!project) throw notFound();
      if (project.activeJobId) await recoverExpiredJob(db, session, ownerId, projectId, project.activeJobId, now);
      const fresh = await db.collection("projects").findOne({ _id: projectId as never, ownerId, deletedAt: null }, { session, projection: { activeJobId: 1 } });
      if (fresh?.activeJobId) throw busy(fresh.activeJobId);
      const draft = await db.collection("drafts").findOne({ ownerId, projectId }, { session });
      if (!draft) throw notFound();
      if (draft.revision !== options.expectedDraftRevision) {
        throw new ApiError(409, "REVISION_CONFLICT", "This draft changed in another tab.", {
          details: { currentRevision: draft.revision, reloadUrl: `/api/projects/${projectId}/draft` },
        });
      }
      const snapshot = { ...(await options.snapshot(draft, session)), draftRevision: draft.revision };
      const claimed = await db.collection("projects").updateOne(
        { _id: projectId as never, ownerId, deletedAt: null, activeJobId: { $exists: false } },
        { $set: { activeJobId: jobId }, $inc: { contentRevision: 1 } },
        { session },
      );
      if (claimed.modifiedCount !== 1) throw busy();

      await db.collection("jobs").insertOne(
        {
          _id: jobId as never,
          schemaVersion: 1,
          ownerId,
          projectId,
          type: options.type,
          state: "queued",
          revision: 1,
          stage: options.stage,
          inputSnapshot: snapshot,
          inputHash: sha256Hex(canonicalJson({ type: options.type, ...snapshot })),
          executionAttempt: 1,
          progress: {},
          deadlineAt: new Date(now.getTime() + options.deadlineMs),
          activeSlot: true,
          createdAt: now,
          updatedAt: now,
        },
        { session },
      );
      await appendMessage(db, session, { ownerId, projectId, conversationId: project.conversationId, role: "user", text: options.userMessage, jobId, messageKey: "request" }, now);
      await db.collection("outbox").insertOne(
        {
          _id: newId("obx") as never,
          schemaVersion: 1,
          ownerId,
          projectId,
          eventId: newId("evt"),
          aggregateId: jobId,
          eventType: options.eventType,
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
    const duplicate = error instanceof MongoServerError && error.code === 11000;
    const winner = duplicate ? await findReceipt(db, identity) : null;
    if (winner) return { jobId: String(winner.responseBody.jobId), replayed: true };
    if (duplicate) throw busy();
    throw error;
  }
  return { jobId, replayed: false };
}

export type JobDoc = Document & { _id: string; ownerId: string; projectId: string; inputSnapshot: Record<string, unknown> };
/** Writes the job's visible output inside the completion transaction and returns the job result + assistant text. */
export type Commit = (session: ClientSession, job: JobDoc, now: Date) => Promise<{ result: Record<string, unknown>; assistantText: string; sourceStoryboardId?: string }>;

export async function runJob(
  { db, client }: JobContext,
  jobId: string,
  type: AcceptOptions["type"],
  execute: (snapshot: Record<string, unknown>) => Promise<Commit>,
): Promise<void> {
  const claimed = await db.collection("jobs").findOneAndUpdate(
    { _id: jobId as never, type, state: "queued" },
    { $set: { state: "running", updatedAt: new Date() }, $inc: { revision: 1 } },
    { returnDocument: "after" },
  );
  if (!claimed) return;

  let commit: Commit | null = null;
  let error: SafeError | null = null;
  try {
    commit = await execute(claimed.inputSnapshot);
  } catch (caught) {
    const provider = caught instanceof ProviderError ? caught : null;
    error = {
      code: provider?.code ?? "INTERNAL_ERROR",
      message: provider?.message ?? "This task couldn’t be completed. Try again.",
      retryable: provider?.retryable ?? true,
      correlationId: newId("cor"),
    };
    if (!provider) console.error(`[${error.correlationId}] ${type} job failed: ${caught instanceof Error ? caught.name : "error"}`);
  }

  const now = new Date();
  await inTransaction(client, async (session) => {
    const jobs = db.collection<JobDoc>("jobs");
    const job = await jobs.findOne({ _id: jobId }, { session });
    if (!job) return;
    if (job.state === "cancel_requested") {
      await jobs.updateOne(
        { _id: jobId, state: "cancel_requested" },
        { $set: { state: "cancelled", finishedAt: now, updatedAt: now }, $unset: { activeSlot: "" }, $inc: { revision: 1 } },
        { session },
      );
    } else if (job.state === "running") {
      const project = await db.collection("projects").findOne({ _id: job.projectId as never, ownerId: job.ownerId, deletedAt: null }, { session });
      let output: Awaited<ReturnType<Commit>> | null = null;
      if (commit && project) output = await commit(session, job, now);
      await jobs.updateOne(
        { _id: jobId, state: "running" },
        {
          $set: {
            state: output ? "succeeded" : "failed",
            ...(output ? { result: output.result } : { error: error ?? { code: "INTERNAL_ERROR", message: "This task couldn’t be completed.", retryable: true, correlationId: newId("cor") } }),
            finishedAt: now,
            updatedAt: now,
          },
          $unset: { activeSlot: "" },
          $inc: { revision: 1 },
        },
        { session },
      );
      if (output && project) {
        await appendMessage(
          db,
          session,
          { ownerId: job.ownerId, projectId: job.projectId, conversationId: project.conversationId, role: "assistant", text: output.assistantText, jobId, messageKey: "result", sourceStoryboardId: output.sourceStoryboardId },
          now,
        );
      }
    } else {
      return;
    }
    await db.collection("projects").updateOne({ _id: job.projectId as never, ownerId: job.ownerId, activeJobId: jobId }, { $unset: { activeJobId: "" } }, { session });
  });
}
