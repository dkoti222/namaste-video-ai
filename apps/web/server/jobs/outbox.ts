import { Long, type Db } from "mongodb";
import { newId } from "../db/migrations";

// Outbox dispatch (SYSTEM_DESIGN.md: committed events, leased dispatch, stable event IDs). A crash between send and
// "mark sent" can redeliver; that is safe because workers claim jobs with CAS and Inngest deduplicates by event ID.

export type OutgoingEvent = { id: string; name: string; data: Record<string, unknown> };
export const JOB_EVENT = "namastevideo/job.requested";
export const PUBLISH_EVENT = "namastevideo/publish.requested";
const LEASE_MS = 60_000;
const MAX_ATTEMPTS = 10;

/** Maps a stored outbox record to the workflow event (IDs only — never content). */
export function toEvent(record: { eventId: string; eventType: string; payloadIds: Record<string, unknown> }): OutgoingEvent | null {
  if (/^job\.[a-z_]+\.requested$/.test(record.eventType) || record.eventType === "project.cleanup_requested") {
    return { id: record.eventId, name: JOB_EVENT, data: { jobId: String(record.payloadIds.jobId) } };
  }
  if (record.eventType === "publish.requested") return { id: record.eventId, name: PUBLISH_EVENT, data: { intentId: String(record.payloadIds.intentId) } };
  return null;
}

export async function dispatchOutbox(db: Db, send: (events: OutgoingEvent[]) => Promise<void>, { limit = 25 }: { limit?: number } = {}) {
  const outbox = db.collection("outbox");
  let sent = 0;
  let failed = 0;
  for (let i = 0; i < limit; i++) {
    const now = new Date();
    const holder = newId("lse");
    const record = await outbox.findOneAndUpdate(
      { $or: [{ state: "pending", availableAt: { $lte: now } }, { state: "leased", "lease.until": { $lt: now } }] },
      [{ $set: { state: "leased", attempts: { $add: ["$attempts", 1] }, lease: { holder, until: new Date(now.getTime() + LEASE_MS), fence: { $toLong: { $add: ["$attempts", 1] } } }, updatedAt: now } }],
      { sort: { availableAt: 1, _id: 1 }, returnDocument: "after" },
    );
    if (!record) break;
    const event = toEvent(record as never);
    try {
      if (event) await send([event]);
      await outbox.updateOne({ _id: record._id, "lease.holder": holder }, { $set: { state: "sent", sentAt: new Date(), updatedAt: new Date() }, $unset: { lease: "" } });
      sent++;
    } catch {
      failed++;
      const attempts = Number(record.attempts);
      const backoffMs = Math.min(15 * 60_000, 2 ** attempts * 5_000);
      await outbox.updateOne(
        { _id: record._id, "lease.holder": holder },
        {
          $set: {
            state: attempts >= MAX_ATTEMPTS ? "dead" : "pending",
            availableAt: new Date(Date.now() + backoffMs),
            lastError: { code: "DISPATCH_FAILED", message: "The job runner could not be reached.", retryable: true, correlationId: newId("cor") },
            updatedAt: new Date(),
          },
          $unset: { lease: "" },
        },
      );
    }
  }
  return { sent, failed };
}

export { Long };
