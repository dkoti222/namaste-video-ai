import { MongoServerError, type ClientSession, type Db, type MongoClient, type TransactionOptions } from "mongodb";
import { z } from "zod";
import { draftPlanStructureIssues } from "../../lib/plan";
import { findReceipt, insertReceipt, type CommandIdentity } from "../commands";
import { ID_PATTERN } from "../db/schema";
import { ApiError, notFound, type FieldError } from "../http";
import { isVoiceAvailable } from "../voices";
import { draftContentHash, draftIssues } from "./rules";

// Idea drafts (API_DESIGN.md P06/P07, DB_DESIGN.md T02): CAS autosave on the draft revision with a live-parent fence.
// Text is stored exactly as typed (no trimming while editing); limits count Unicode code points.

const TXN: TransactionOptions = { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" }, readPreference: "primary" };
const idRegex = new RegExp(ID_PATTERN);
const codePoints = (text: string) => [...text].length;
const bounded = (max: number, label: string) =>
  z.string().refine((value) => codePoints(value) <= max, { message: `${label} can be at most ${max.toLocaleString("en-US")} characters.` });

export const draftChanges = z
  .strictObject({
    topic: bounded(2000, "Topic").optional(),
    audience: bounded(200, "Audience").optional(),
    notes: bounded(20000, "Notes").optional(),
    voicePreset: z.string().min(1).max(64).optional(),
    // Working storyboard (DraftPlanV2): structurally checked here and in updateDraft; incomplete text is saved with issues.
    editablePlan: z
      .union([z.null(), z.record(z.string(), z.unknown())])
      .refine((plan) => plan === null || Buffer.byteLength(JSON.stringify(plan)) <= 128 * 1024, { message: "The storyboard is too large." })
      .optional(),
  })
  .refine((changes) => Object.keys(changes).length > 0, { message: "Change at least one field." });

export const updateDraftBody = z.strictObject({ expectedRevision: z.number().int().min(1), changes: draftChanges });

type DraftDoc = {
  _id: string;
  ownerId: string;
  projectId: string;
  revision: number;
  topic: string;
  audience: string;
  notes: string;
  voicePreset: string;
  editablePlan: Record<string, unknown> | null;
  sourceStoryboardId?: string;
  planStale: boolean;
  contentHash: string;
  validationIssues: FieldError[];
  updatedAt: Date;
};

export type DraftView = {
  projectId: string;
  conversationId: string;
  revision: number;
  topic: string;
  audience: string;
  notes: string;
  voicePreset: string;
  editablePlan: Record<string, unknown> | null;
  sourceStoryboardId: string | null;
  planStale: boolean;
  contentHash: string;
  validation: { valid: boolean; issues: FieldError[] };
  updatedAt: string;
};

function toView(draft: DraftDoc, conversationId: string): DraftView {
  return {
    projectId: draft.projectId,
    conversationId,
    revision: draft.revision,
    topic: draft.topic,
    audience: draft.audience,
    notes: draft.notes,
    voicePreset: draft.voicePreset,
    editablePlan: draft.editablePlan,
    sourceStoryboardId: draft.sourceStoryboardId ?? null,
    planStale: draft.planStale,
    contentHash: draft.contentHash,
    validation: { valid: draft.validationIssues.length === 0, issues: draft.validationIssues },
    updatedAt: draft.updatedAt.toISOString(),
  };
}

const drafts = (db: Db) => db.collection<DraftDoc>("drafts");
const liveProject = (db: Db, ownerId: string, projectId: string, session?: ClientSession) =>
  db.collection("projects").findOne({ _id: projectId as never, ownerId, deletedAt: null }, { session, projection: { conversationId: 1, draftRevision: 1 } });

export async function getDraft(db: Db, ownerId: string, projectId: string): Promise<DraftView | null> {
  if (!idRegex.test(projectId)) return null;
  const project = await liveProject(db, ownerId, projectId);
  if (!project) return null;
  const draft = await drafts(db).findOne({ ownerId, projectId });
  return draft ? toView(draft, project.conversationId) : null;
}

/**
 * P07/T02: one transaction fences the live parent on its mirrored draftRevision, then CAS-updates the draft.
 * A stale expectedRevision returns 409 with the current revision; the client keeps its local text.
 */
export async function updateDraft(
  { db, client }: { db: Db; client: MongoClient },
  ownerId: string,
  projectId: string,
  body: z.infer<typeof updateDraftBody>,
): Promise<DraftView> {
  if (!idRegex.test(projectId)) throw notFound();
  const { changes, expectedRevision } = body;
  if (changes.voicePreset !== undefined && !isVoiceAvailable(changes.voicePreset)) {
    throw new ApiError(422, "VOICE_UNAVAILABLE", "This narrator isn’t available. Choose another voice.", {
      fieldErrors: [{ path: "changes.voicePreset", code: "VOICE_UNAVAILABLE", message: "Choose an available narrator." }],
    });
  }

  if (changes.editablePlan) {
    const structural = draftPlanStructureIssues(changes.editablePlan);
    if (structural) {
      throw new ApiError(422, "INVALID_DRAFT", "The storyboard has an unsupported structure.", {
        fieldErrors: structural.slice(0, 50).map((i) => ({ ...i, path: `changes.editablePlan.${i.path}` })),
      });
    }
  }

  const session = client.startSession();
  try {
    return await session.withTransaction(async () => {
      const current = await drafts(db).findOne({ ownerId, projectId }, { session });
      const project = await liveProject(db, ownerId, projectId, session);
      if (!current || !project) throw notFound();
      if (current.revision !== expectedRevision) throw conflict(current.revision, projectId);

      const next = {
        topic: changes.topic ?? current.topic,
        audience: changes.audience ?? current.audience,
        notes: changes.notes ?? current.notes,
        voicePreset: changes.voicePreset ?? current.voicePreset,
        editablePlan: changes.editablePlan !== undefined ? changes.editablePlan : current.editablePlan,
      };
      const inputsChanged = next.topic !== current.topic || next.notes !== current.notes || next.voicePreset !== current.voicePreset;
      // Changing the idea marks an existing working storyboard stale until it is replanned; clearing it resets that.
      const planStale = next.editablePlan === null ? false : current.planStale || inputsChanged;
      const now = new Date();
      const newRevision = expectedRevision + 1;

      const fenced = await db.collection("projects").updateOne(
        { _id: projectId as never, ownerId, deletedAt: null, draftRevision: expectedRevision },
        { $set: { draftRevision: newRevision, updatedAt: now }, $inc: { contentRevision: 1 } },
        { session },
      );
      if (fenced.modifiedCount !== 1) throw conflict(current.revision, projectId);

      const updated = await drafts(db).findOneAndUpdate(
        { _id: current._id, ownerId, projectId, revision: expectedRevision },
        {
          $set: {
            ...next,
            planStale,
            contentHash: draftContentHash(next),
            validationIssues: draftIssues(next),
            updatedAt: now,
          },
          $inc: { revision: 1 },
        },
        { session, returnDocument: "after" },
      );
      if (!updated) throw conflict(current.revision, projectId);
      return toView(updated, project.conversationId);
    }, TXN);
  } finally {
    await session.endSession();
  }
}

function conflict(currentRevision: number, projectId: string) {
  return new ApiError(409, "REVISION_CONFLICT", "This draft changed in another tab.", {
    details: { currentRevision, reloadUrl: `/api/projects/${projectId}/draft` },
  });
}

export const applyStoryboardBody = z.strictObject({
  expectedDraftRevision: z.number().int().min(1),
  storyboardId: z.string().regex(idRegex),
  expectedContentHash: z.string().regex(/^[a-f0-9]{64}$/),
});

/**
 * S06: copies a saved storyboard candidate into the working draft (editablePlan) and points the project at it.
 * Checks the exact content hash and draft revision; the storyboard must belong to the same owner/project and match
 * the draft's narrator. Idempotent by key. Never generates audio.
 */
export async function applyStoryboard(
  { db, client }: { db: Db; client: MongoClient },
  identity: CommandIdentity,
  projectId: string,
  body: z.infer<typeof applyStoryboardBody>,
): Promise<{ draft: DraftView; replayed: boolean }> {
  if (!idRegex.test(projectId)) throw notFound();
  const replay = async () => {
    const draft = await getDraft(db, identity.ownerId, projectId);
    if (!draft) throw notFound();
    return { draft, replayed: true };
  };
  if (await findReceipt(db, identity)) return replay();

  const { ownerId } = identity;
  const session = client.startSession();
  try {
    const draft = await session.withTransaction(async () => {
      const project = await liveProject(db, ownerId, projectId, session);
      const current = await drafts(db).findOne({ ownerId, projectId }, { session });
      if (!project || !current) throw notFound();
      const storyboard = await db.collection("storyboards").findOne({ _id: body.storyboardId as never, ownerId, projectId }, { session });
      if (!storyboard) throw notFound();
      if (storyboard.contentHash !== body.expectedContentHash) {
        throw new ApiError(409, "HASH_MISMATCH", "This storyboard version is different from the one you reviewed. Reload it.");
      }
      if (current.revision !== body.expectedDraftRevision) throw conflict(current.revision, projectId);
      if (storyboard.content.voicePreset !== current.voicePreset) {
        throw new ApiError(422, "VALIDATION_FAILED", "This storyboard was made for a different narrator. Create a new storyboard for the selected voice.", {
          fieldErrors: [{ path: "storyboardId", code: "VOICE_MISMATCH", message: "Narrator differs from the draft." }],
        });
      }
      const now = new Date();
      const newRevision = body.expectedDraftRevision + 1;
      const fenced = await db.collection("projects").updateOne(
        { _id: projectId as never, ownerId, deletedAt: null, draftRevision: body.expectedDraftRevision },
        { $set: { draftRevision: newRevision, currentStoryboardId: body.storyboardId, updatedAt: now }, $inc: { contentRevision: 1 } },
        { session },
      );
      if (fenced.modifiedCount !== 1) throw conflict(current.revision, projectId);
      const next = { topic: current.topic, audience: current.audience, notes: current.notes, voicePreset: current.voicePreset, editablePlan: storyboard.content };
      const updated = await drafts(db).findOneAndUpdate(
        { _id: current._id, revision: body.expectedDraftRevision },
        {
          $set: {
            editablePlan: storyboard.content,
            sourceStoryboardId: body.storyboardId,
            planStale: false,
            contentHash: draftContentHash(next),
            validationIssues: draftIssues(next),
            updatedAt: now,
          },
          $inc: { revision: 1 },
        },
        { session, returnDocument: "after" },
      );
      if (!updated) throw conflict(current.revision, projectId);
      await insertReceipt(db, session, identity, { responseStatus: 200, responseBody: { draftRevision: newRevision }, resourceIds: [body.storyboardId, projectId], projectId }, now);
      return toView(updated, project.conversationId);
    }, TXN);
    return { draft, replayed: false };
  } catch (error) {
    if (error instanceof MongoServerError && error.code === 11000 && (await findReceipt(db, identity))) return replay();
    throw error;
  } finally {
    await session.endSession();
  }
}
