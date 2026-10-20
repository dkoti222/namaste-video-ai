import type { Db } from "mongodb";
import type { ObjectStore } from "../media/object-store";
import { revokeProjectGrants } from "../media/assets";

// Project cleanup (DB_DESIGN.md section 12): after the tombstone, revoke grants, delete stored objects (already-missing
// objects count as deleted) and remove project content in bounded, idempotent passes. The tombstoned project record,
// its cleanup job and the deletion receipt remain so the owner can read the cleanup status.

const CONTENT_COLLECTIONS = ["drafts", "conversations", "messages", "storyboards", "approvals", "videos", "jobStages", "stageAttempts", "renderAttempts", "diagnosticEvents"];

export async function runCleanup(db: Db, store: ObjectStore | null, jobId: string): Promise<string> {
  const job = await db.collection("jobs").findOneAndUpdate(
    { _id: jobId as never, type: "cleanup", state: { $in: ["queued", "running"] } },
    { $set: { state: "running", updatedAt: new Date() }, $inc: { revision: 1 } },
    { returnDocument: "after" },
  );
  if (!job) return "not-claimed";
  const { ownerId, projectId } = job;
  const project = await db.collection("projects").findOne({ _id: projectId, ownerId }, { projection: { deletedAt: 1 } });
  if (!project?.deletedAt) throw new Error("Cleanup requires a tombstoned project");

  await revokeProjectGrants(db, ownerId, projectId);
  if (!store) throw new Error("Object storage is not configured; cleanup will retry.");
  for (;;) {
    const batch = await db.collection("assets").find({ ownerId, projectId, state: { $in: ["staging", "ready", "deleting"] } }).limit(50).toArray();
    if (!batch.length) break;
    for (const asset of batch) {
      await db.collection("assets").updateOne({ _id: asset._id }, { $set: { state: "deleting", updatedAt: new Date() } });
      await store.delete(asset.objectKey);
      await db.collection("assets").updateOne({ _id: asset._id }, { $set: { state: "deleted", updatedAt: new Date() } });
    }
  }
  for (const name of CONTENT_COLLECTIONS) await db.collection(name).deleteMany({ ownerId, projectId });
  await db.collection("jobs").deleteMany({ ownerId, projectId, type: { $ne: "cleanup" } });
  await db.collection("commands").deleteMany({ ownerId, projectId, scope: { $not: /^DELETE / } });
  await db.collection("mediaGrants").deleteMany({ ownerId, projectId });

  const now = new Date();
  await db.collection("jobs").updateOne(
    { _id: jobId as never, state: "running" },
    { $set: { state: "succeeded", stage: "cleanup", result: { kind: "cleanup", externalOutcomePending: false }, finishedAt: now, updatedAt: now }, $inc: { revision: 1 } },
  );
  return "cleaned";
}
