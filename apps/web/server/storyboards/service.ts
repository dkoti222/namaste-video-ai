import type { Db } from "mongodb";
import { z } from "zod";
import { canonicalJson, sha256Hex } from "../../lib/canonical";
import type { FieldIssue, PlanV2 } from "../../lib/plan";
import { estimateSeconds } from "../../lib/plan";
import type { CommandIdentity } from "../commands";
import { decodeCursor, encodeCursor } from "../cursor";
import { newId } from "../db/migrations";
import { ideaIssues } from "../drafts/rules";
import { ApiError } from "../http";
import { PROMPT_VERSION, REVISION_PROMPT_VERSION, type PlannedStoryboard, type PlannerInput, type RevisedStoryboard, type RevisionInput } from "../ai/planner";
import { acceptJob, idRegex, inTransaction, runJob, type JobContext, type JobDoc } from "../jobs/core";
import { findReceipt, insertReceipt } from "../commands";
import { MongoServerError, type ClientSession } from "mongodb";
import { validatePlanV2 } from "../../lib/plan";
import { isVoiceAvailable } from "../voices";

// Storyboards (API_DESIGN.md S03-S05, DB_DESIGN.md section 5.3). Each generation saves an immutable candidate
// (state review_ready); it never overwrites the working draft. Applying a candidate is a separate command (F10/F11).

export const createStoryboardBody = z.strictObject({ expectedDraftRevision: z.number().int().min(1) });
export const listStoryboardsQuery = z.strictObject({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().max(2048).optional(),
});

/** Hash of the complete PlanV2 snapshot. */
export const storyboardContentHash = (plan: PlanV2) => sha256Hex(canonicalJson({ canonicalizationVersion: 1, plan }));

/**
 * Story hash: spoken text, pronunciation, on-screen text, ordered semantic visual facts, events (target/action/cue),
 * sources and voice. Excludes presentational timing (cue offsets, durations) so visual-only tweaks can keep approval.
 */
export function storyHash(plan: PlanV2): string {
  return sha256Hex(
    canonicalJson({
      canonicalizationVersion: 1,
      voicePreset: plan.voicePreset,
      title: plan.title,
      sources: plan.sources,
      scenes: plan.scenes.map((s) => ({
        id: s.id,
        title: s.title,
        kicker: s.kicker,
        narration: s.narration,
        pronunciation: s.pronunciation,
        visual: s.visual,
        events: s.events.map((e) => ({ targetId: e.targetId, action: e.action, phrase: e.cue.phrase, occurrence: e.cue.occurrence })),
        sourceIds: s.sourceIds,
      })),
    }),
  );
}

type StoryboardDoc = {
  _id: string;
  ownerId: string;
  projectId: string;
  parentId?: string;
  sourceDraftRevision: number;
  content: PlanV2;
  contentHash: string;
  storyHash: string;
  state: "review_ready" | "approved";
  estimatedDurationSeconds: number;
  changeSummary?: string;
  changedSceneIds: string[];
  warnings: FieldIssue[];
  createdAt: Date;
};

export type StoryboardSummary = {
  id: string;
  projectId: string;
  parentId: string | null;
  sourceDraftRevision: number;
  state: StoryboardDoc["state"];
  title: string;
  sceneCount: number;
  contentHash: string;
  storyHash: string;
  estimatedDurationSeconds: number;
  warnings: FieldIssue[];
  changeSummary: string | null;
  changedSceneIds: string[];
  approvalId: string | null;
  createdAt: string;
};
export type StoryboardView = Omit<StoryboardSummary, "title" | "sceneCount"> & { content: PlanV2 };

function summary(doc: StoryboardDoc): StoryboardSummary {
  return {
    id: doc._id,
    projectId: doc.projectId,
    parentId: doc.parentId ?? null,
    sourceDraftRevision: doc.sourceDraftRevision,
    state: doc.state,
    title: doc.content.title,
    sceneCount: doc.content.scenes.length,
    contentHash: doc.contentHash,
    storyHash: doc.storyHash,
    estimatedDurationSeconds: doc.estimatedDurationSeconds,
    warnings: doc.warnings,
    changeSummary: doc.changeSummary ?? null,
    changedSceneIds: doc.changedSceneIds,
    approvalId: null,
    createdAt: doc.createdAt.toISOString(),
  };
}

const storyboards = (db: Db) => db.collection<StoryboardDoc>("storyboards");

/** Story approvals for storyboards, matched on the exact story hash (uses the approval_subject index). */
async function approvalIds(db: Db, ownerId: string, docs: Pick<StoryboardDoc, "_id" | "storyHash">[]): Promise<Map<string, string>> {
  if (!docs.length) return new Map();
  const approvals = await db
    .collection("approvals")
    .find({ ownerId, kind: "story", subjectId: { $in: docs.map((d) => d._id) } }, { projection: { subjectId: 1, subjectHash: 1 } })
    .toArray();
  const map = new Map<string, string>();
  for (const doc of docs) {
    const match = approvals.find((a) => a.subjectId === doc._id && a.subjectHash === doc.storyHash);
    if (match) map.set(doc._id, String(match._id));
  }
  return map;
}
const liveProject = (db: Db, ownerId: string, projectId: string) =>
  db.collection("projects").findOne({ _id: projectId as never, ownerId, deletedAt: null }, { projection: { _id: 1 } });

export async function getStoryboard(db: Db, ownerId: string, storyboardId: string): Promise<StoryboardView | null> {
  if (!idRegex.test(storyboardId)) return null;
  const doc = await storyboards(db).findOne({ _id: storyboardId, ownerId });
  if (!doc || !(await liveProject(db, ownerId, doc.projectId))) return null;
  const { title: _t, sceneCount: _c, ...rest } = summary(doc);
  const approvals = await approvalIds(db, ownerId, [doc]);
  return { ...rest, approvalId: approvals.get(doc._id) ?? null, content: doc.content };
}

export async function listStoryboards(
  db: Db,
  cursorSecret: string,
  ownerId: string,
  projectId: string,
  query: z.infer<typeof listStoryboardsQuery>,
): Promise<{ items: StoryboardSummary[]; nextCursor: string | null; hasMore: boolean } | null> {
  if (!idRegex.test(projectId) || !(await liveProject(db, ownerId, projectId))) return null;
  const binding = { ownerId, route: `storyboards:${projectId}`, filter: "all" };
  const filter: Record<string, unknown> = { ownerId, projectId };
  if (query.cursor) {
    const at = decodeCursor(cursorSecret, binding, query.cursor);
    filter.$or = [{ createdAt: { $lt: new Date(at.sortMs) } }, { createdAt: new Date(at.sortMs), _id: { $lt: at.id } }];
  }
  // Summaries exclude the full content except the fields needed for title/scene count.
  const docs = await storyboards(db)
    .find(filter, { projection: { "content.sources": 0 } })
    .sort({ createdAt: -1, _id: -1 })
    .limit(query.limit + 1)
    .toArray();
  const hasMore = docs.length > query.limit;
  const page = docs.slice(0, query.limit);
  const last = page.at(-1);
  const approvals = await approvalIds(db, ownerId, page);
  return {
    items: page.map((doc) => ({ ...summary(doc), approvalId: approvals.get(doc._id) ?? null })),
    hasMore,
    nextCursor: hasMore && last ? encodeCursor(cursorSecret, binding, { sortMs: last.createdAt.getTime(), id: last._id }) : null,
  };
}

type Snapshot = PlannerInput & { draftRevision: number };

/** S03: requires a saved, meaningful topic and an available narrator. */
export function acceptStoryboard(ctx: JobContext, identity: CommandIdentity, projectId: string, body: z.infer<typeof createStoryboardBody>) {
  return acceptJob(ctx, identity, projectId, {
    type: "storyboard",
    stage: "planning",
    expectedDraftRevision: body.expectedDraftRevision,
    deadlineMs: 10 * 60_000,
    eventType: "job.storyboard.requested",
    snapshot: (draft) => {
      const issues = ideaIssues({ topic: draft.topic, voicePreset: draft.voicePreset });
      if (issues.length) {
        throw new ApiError(422, "INVALID_DRAFT", "Complete your idea before creating a storyboard.", {
          fieldErrors: issues.map((i) => ({ ...i, path: `draft.${i.path}` })),
        });
      }
      return { topic: draft.topic, audience: draft.audience, notes: draft.notes, voicePreset: draft.voicePreset };
    },
    userMessage: "Create a storyboard from my saved idea.",
  });
}

/** Scene IDs added, removed or changed between two plans (bounded by the storyboard schema). */
export function changedScenes(before: PlanV2, after: PlanV2): string[] {
  const old = new Map(before.scenes.map((scene) => [scene.id, canonicalJson(scene)]));
  const changed = after.scenes.filter((scene) => old.get(scene.id) !== canonicalJson(scene)).map((scene) => scene.id);
  const removed = before.scenes.filter((scene) => !after.scenes.some((x) => x.id === scene.id)).map((scene) => scene.id);
  return [...changed, ...removed].slice(0, 10);
}

async function insertCandidate(
  ctx: JobContext,
  session: ClientSession,
  job: JobDoc,
  now: Date,
  content: PlanV2,
  meta: { sourceDraftRevision: number; warnings: FieldIssue[]; plannerConfig: { provider: string; model: string; promptVersion: string }; parentId?: string; changeSummary?: string; changedSceneIds?: string[] },
): Promise<string> {
  const storyboardId = newId("stb");
  await ctx.db.collection("storyboards").insertOne(
    {
      _id: storyboardId as never,
      schemaVersion: 1,
      ownerId: job.ownerId,
      projectId: job.projectId,
      ...(meta.parentId ? { parentId: meta.parentId } : {}),
      sourceDraftRevision: meta.sourceDraftRevision,
      content,
      contentHash: storyboardContentHash(content),
      storyHash: storyHash(content),
      canonicalizationVersion: 1,
      state: "review_ready",
      estimatedDurationSeconds: estimateSeconds(content),
      ...(meta.changeSummary ? { changeSummary: meta.changeSummary } : {}),
      changedSceneIds: meta.changedSceneIds ?? [],
      warnings: meta.warnings,
      plannerConfig: meta.plannerConfig,
      createdByJobId: job._id,
      createdAt: now,
      updatedAt: now,
    },
    { session },
  );
  return storyboardId;
}

/** Executes a queued storyboard job once; the candidate is inserted in the completion transaction. */
export function runStoryboard(ctx: JobContext, jobId: string, plan: (input: PlannerInput) => Promise<PlannedStoryboard>, model: string) {
  return runJob(ctx, jobId, "storyboard", async (raw) => {
    const snapshot = raw as Snapshot;
    const planned = await plan(snapshot);
    return async (session, job, now) => {
      const content = planned.plan;
      const storyboardId = await insertCandidate(ctx, session, job, now, content, {
        sourceDraftRevision: snapshot.draftRevision,
        warnings: planned.warnings,
        plannerConfig: { provider: "gemini", model, promptVersion: PROMPT_VERSION },
      });
      return {
        result: { kind: "storyboard", storyboardId, requiresApply: true },
        assistantText: `Storyboard ready: “${content.title}” — ${content.scenes.length} scenes, about ${Math.round(estimateSeconds(content))} seconds.`,
        sourceStoryboardId: storyboardId,
      };
    };
  });
}

// ---- S08 conversational revisions ---------------------------------------------------------------------------------

export const revisionBody = z.strictObject({
  source: z.strictObject({ kind: z.enum(["storyboard", "video"]), id: z.string().regex(idRegex), hash: z.string().regex(/^[a-f0-9]{64}$/) }),
  expectedDraftRevision: z.number().int().min(1),
  instruction: z
    .string()
    .refine((value) => value.trim().length > 0, { message: "Describe the change you want." })
    .refine((value) => [...value].length <= 4000, { message: "Use at most 4,000 characters." }),
  sceneId: z.string().regex(/^[a-z][a-z0-9-]{0,49}$/).optional(),
});

type RevisionSnapshot = RevisionInput & { sourceStoryboardId: string; draftRevision: number };

/**
 * Revisions resolve against a specific version: the source storyboard must be the one the working draft came from
 * (exact hash), and the job revises the saved working storyboard including the user's manual edits.
 */
export async function acceptRevision(ctx: JobContext, identity: CommandIdentity, projectId: string, body: z.infer<typeof revisionBody>) {
  if (body.source.kind === "video") {
    throw new ApiError(422, "VALIDATION_FAILED", "Revising a video arrives with video review.", {
      fieldErrors: [{ path: "source.kind", code: "NOT_AVAILABLE", message: "Only storyboard revisions are available." }],
    });
  }
  return acceptJob(ctx, identity, projectId, {
    type: "revision",
    stage: "planning",
    expectedDraftRevision: body.expectedDraftRevision,
    deadlineMs: 10 * 60_000,
    eventType: "job.revision.requested",
    snapshot: async (draft, session) => {
      const source = await ctx.db.collection("storyboards").findOne({ _id: body.source.id as never, ownerId: identity.ownerId, projectId }, { session, projection: { contentHash: 1 } });
      if (!draft.editablePlan || !source || source.contentHash !== body.source.hash || draft.sourceStoryboardId !== body.source.id) {
        throw new ApiError(409, "SOURCE_CHANGED", "The storyboard changed since you started this request. Reload and try again.");
      }
      const plan = draft.editablePlan as PlanV2;
      if (body.sceneId && !plan.scenes.some((scene) => scene.id === body.sceneId)) {
        throw new ApiError(422, "INVALID_SCENE", "That scene no longer exists in this storyboard.");
      }
      return {
        instruction: body.instruction,
        ...(body.sceneId ? { sceneId: body.sceneId } : {}),
        plan,
        sourceStoryboardId: body.source.id,
        topic: draft.topic,
        audience: draft.audience,
        notes: draft.notes,
        voicePreset: draft.voicePreset,
      };
    },
    userMessage: body.sceneId ? `Scene ${body.sceneId}: ${body.instruction}` : body.instruction,
  });
}

export function runRevision(ctx: JobContext, jobId: string, revise: (input: RevisionInput) => Promise<RevisedStoryboard>, model: string) {
  return runJob(ctx, jobId, "revision", async (raw) => {
    const snapshot = raw as unknown as RevisionSnapshot;
    const revised = await revise(snapshot);
    return async (session, job, now) => {
      const changedSceneIds = changedScenes(snapshot.plan, revised.plan);
      const storyboardId = await insertCandidate(ctx, session, job, now, revised.plan, {
        sourceDraftRevision: snapshot.draftRevision,
        warnings: revised.warnings,
        plannerConfig: { provider: "gemini", model, promptVersion: REVISION_PROMPT_VERSION },
        parentId: snapshot.sourceStoryboardId,
        changeSummary: revised.changeSummary,
        changedSceneIds,
      });
      return {
        result: { kind: "storyboard", storyboardId, requiresApply: true },
        assistantText: changedSceneIds.length ? `${revised.changeSummary} Changed scenes: ${changedSceneIds.join(", ")}.` : `${revised.changeSummary} No scenes needed changes.`,
        sourceStoryboardId: storyboardId,
      };
    };
  });
}

// ---- Story approval (T05, approval half) --------------------------------------------------------------------------

export const approveBody = z.strictObject({
  expectedDraftRevision: z.number().int().min(1),
  expectedContentHash: z.string().regex(/^[a-f0-9]{64}$/),
  approve: z.literal(true),
});

export type ApprovalView = { id: string; kind: "story"; subjectId: string; subjectHash: string; approvedAt: string };

/**
 * Approves the exact saved working storyboard. Rejects unsaved/changed drafts (revision + content hash), invalid or
 * stale plans, unavailable narrators and lengths outside the target. The approved content becomes an immutable
 * storyboard (the existing candidate when identical, otherwise a new snapshot) with a story approval record.
 * Later edits never alter it; they need a new approval. Video generation will build on this (F13, G01).
 */
export async function approveStoryboard(
  ctx: JobContext,
  identity: CommandIdentity,
  projectId: string,
  body: z.infer<typeof approveBody>,
): Promise<{ approval: ApprovalView; storyboard: StoryboardSummary; replayed: boolean }> {
  const { db, client } = ctx;
  const { ownerId } = identity;
  if (!idRegex.test(projectId)) throw new ApiError(404, "NOT_FOUND", "This item is unavailable.");
  const load = async (approvalId: string) => {
    const approval = await db.collection("approvals").findOne({ _id: approvalId as never, ownerId });
    const storyboard = approval ? await storyboards(db).findOne({ _id: approval.subjectId, ownerId }) : null;
    if (!approval || !storyboard || !(await liveProject(db, ownerId, projectId))) throw new ApiError(404, "NOT_FOUND", "This item is unavailable.");
    return {
      approval: { id: String(approval._id), kind: "story" as const, subjectId: approval.subjectId, subjectHash: approval.subjectHash, approvedAt: approval.approvedAt.toISOString() },
      storyboard: { ...summary(storyboard), approvalId: String(approval._id) },
    };
  };
  const prior = await findReceipt(db, identity);
  if (prior) return { ...(await load(String(prior.responseBody.approvalId))), replayed: true };

  let approvalId = "";
  try {
    approvalId = await inTransaction(client, async (session) => {
      const approved = await approveInSession(db, session, ownerId, projectId, body);
      if (approved.created) {
        await insertReceipt(db, session, identity, { responseStatus: 201, responseBody: { approvalId: approved.approvalId }, resourceIds: [approved.approvalId, approved.storyboardId], projectId }, new Date());
      }
      return approved.approvalId;
    });
  } catch (error) {
    if (error instanceof MongoServerError && error.code === 11000) {
      const winner = await findReceipt(db, identity);
      if (winner) return { ...(await load(String(winner.responseBody.approvalId))), replayed: true };
    }
    throw error;
  }
  return { ...(await load(approvalId)), replayed: false };
}

/**
 * T05 approval half, inside the caller's transaction: validates the exact saved draft and approves it, snapshotting
 * edited content immutably. Shared by the approval endpoint and G01 (approve & generate).
 */
export async function approveInSession(
  db: Db,
  session: ClientSession,
  ownerId: string,
  projectId: string,
  body: { expectedDraftRevision: number; expectedContentHash: string },
): Promise<{ approvalId: string; storyboardId: string; plan: PlanV2; storyHash: string; draftRevision: number; created: boolean }> {
  const invalid = (message: string, fieldErrors?: FieldIssue[]) => new ApiError(422, "INVALID_DRAFT", message, fieldErrors ? { fieldErrors: fieldErrors.slice(0, 50) } : {});
    const project = await db.collection("projects").findOne({ _id: projectId as never, ownerId, deletedAt: null }, { session });
    const draft = await db.collection("drafts").findOne({ ownerId, projectId }, { session });
    if (!project || !draft) throw new ApiError(404, "NOT_FOUND", "This item is unavailable.");
    if (draft.revision !== body.expectedDraftRevision) {
      throw new ApiError(409, "REVISION_CONFLICT", "This draft changed in another tab.", { details: { currentRevision: draft.revision, reloadUrl: `/api/projects/${projectId}/draft` } });
    }
    if (draft.contentHash !== body.expectedContentHash) throw new ApiError(409, "HASH_MISMATCH", "The saved storyboard differs from the one you reviewed. Reload it.");
    if (!draft.editablePlan) throw invalid("Create a storyboard before approving.");
    if (draft.planStale) throw invalid("Your idea changed after this storyboard was made. Create a new storyboard or revise it first.");
    if (!isVoiceAvailable(draft.voicePreset)) throw new ApiError(422, "VOICE_UNAVAILABLE", "This narrator isn’t available. Choose another voice.");
    const { plan, issues, warnings } = validatePlanV2(draft.editablePlan);
    if (!plan) throw invalid("Fix the storyboard issues before approving.", issues);
    if (plan.voicePreset !== draft.voicePreset) throw invalid("The storyboard was made for a different narrator.");
    if (warnings.some((w) => w.code === "DURATION_ESTIMATE")) throw invalid("Adjust the narration so the video lasts 60–90 seconds before approving.", warnings);

    const now = new Date();
    const contentHash = storyboardContentHash(plan);
    const source = draft.sourceStoryboardId ? await storyboards(db).findOne({ _id: draft.sourceStoryboardId, ownerId, projectId }, { session }) : null;
    let storyboardId: string;
    if (source && source.contentHash === contentHash) {
      storyboardId = source._id;
      const existing = await db.collection("approvals").findOne({ ownerId, kind: "story", subjectId: source._id, subjectHash: source.storyHash }, { session, projection: { _id: 1 } });
      if (existing) return { approvalId: String(existing._id), storyboardId, plan, storyHash: storyHash(plan), draftRevision: draft.revision, created: false }; // already approved exactly this content
    } else {
      // The working storyboard was edited after generation: snapshot the exact approved content immutably.
      storyboardId = newId("stb");
      await db.collection("storyboards").insertOne(
        {
          _id: storyboardId as never,
          schemaVersion: 1,
          ownerId,
          projectId,
          ...(source ? { parentId: source._id } : {}),
          sourceDraftRevision: draft.revision,
          content: plan,
          contentHash,
          storyHash: storyHash(plan),
          canonicalizationVersion: 1,
          state: "review_ready",
          estimatedDurationSeconds: estimateSeconds(plan),
          changeSummary: "Edited during review.",
          changedSceneIds: source ? changedScenes(source.content, plan) : [],
          warnings,
          plannerConfig: { provider: "editor", model: "manual", promptVersion: "n/a" },
          createdAt: now,
          updatedAt: now,
        },
        { session },
      );
    }
    const newApprovalId = newId("apr");
    await db.collection("approvals").insertOne(
      { _id: newApprovalId as never, schemaVersion: 1, ownerId, projectId, kind: "story", subjectId: storyboardId, subjectHash: storyHash(plan), approvedBy: ownerId, approvedAt: now, reason: "explicit", createdAt: now, updatedAt: now },
      { session },
    );
    // Lifecycle-only change on the immutable storyboard: content and hashes never mutate.
    await db.collection("storyboards").updateOne(
      { _id: storyboardId as never, state: "review_ready", contentHash },
      { $set: { state: "approved", updatedAt: now } },
      { session },
    );
    await db.collection("drafts").updateOne(
      { _id: draft._id, revision: body.expectedDraftRevision },
      { $set: { sourceStoryboardId: storyboardId, updatedAt: now }, $inc: { revision: 1 } },
      { session },
    );
    await db.collection("projects").updateOne(
      { _id: projectId as never, ownerId, deletedAt: null, draftRevision: body.expectedDraftRevision },
      { $set: { currentStoryboardId: storyboardId, draftRevision: body.expectedDraftRevision + 1, updatedAt: now }, $inc: { contentRevision: 1 } },
      { session },
    );
    return { approvalId: newApprovalId, storyboardId, plan, storyHash: storyHash(plan), draftRevision: body.expectedDraftRevision + 1, created: true };
}
