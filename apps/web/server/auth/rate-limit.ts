import { createHmac } from "node:crypto";
import { MongoServerError, type Db } from "mongodb";
import { newId } from "../db/migrations";

// Failed sign-in throttling (API_DESIGN.md section 3): per normalized-email hash and per IP hash in fixed windows.
// Keys are HMACs, so raw emails and IP addresses are never stored.

export type LoginLimits = { perEmail: number; perIp: number; windowMs: number };
export const DEFAULT_LOGIN_LIMITS: LoginLimits = { perEmail: 5, perIp: 30, windowMs: 15 * 60_000 };

const ACTION = "sign_in_failure";

function subjects(secret: string, email: string, ip: string, limits: LoginLimits) {
  const key = createHmac("sha256", secret).update("namastevideo:rate-limit:v1").digest();
  const subjectHash = (value: string) => createHmac("sha256", key).update(value).digest("hex");
  return [
    { subjectHash: subjectHash(`email:${email}`), limit: limits.perEmail },
    { subjectHash: subjectHash(`ip:${ip}`), limit: limits.perIp },
  ];
}

const windowStart = (now: Date, limits: LoginLimits) => new Date(Math.floor(now.getTime() / limits.windowMs) * limits.windowMs);
const buckets = (db: Db) => db.collection("rateLimitBuckets");

/** Seconds until sign-in may be retried, or null when neither subject has reached its limit. */
export async function loginRetryAfter(
  db: Db,
  secret: string,
  email: string,
  ip: string,
  limits: LoginLimits,
  now = new Date(),
): Promise<number | null> {
  const start = windowStart(now, limits);
  const keys = subjects(secret, email, ip, limits);
  const found = await buckets(db)
    .find({ action: ACTION, windowStart: start, subjectHash: { $in: keys.map((k) => k.subjectHash) } })
    .toArray();
  const blocked = keys.some((key) => (found.find((b) => b.subjectHash === key.subjectHash)?.count ?? 0) >= key.limit);
  return blocked ? Math.max(1, Math.ceil((start.getTime() + limits.windowMs - now.getTime()) / 1000)) : null;
}

export async function recordLoginFailure(db: Db, secret: string, email: string, ip: string, limits: LoginLimits, now = new Date()) {
  const start = windowStart(now, limits);
  for (const { subjectHash } of subjects(secret, email, ip, limits)) {
    const update = () =>
      buckets(db).updateOne(
        { subjectHash, action: ACTION, windowStart: start },
        {
          $inc: { count: 1 },
          $set: { updatedAt: now },
          $setOnInsert: {
            _id: newId("rlb") as never,
            schemaVersion: 1,
            createdAt: now,
            // TTL cleanup only; authorization always compares windows in code.
            expiresAt: new Date(start.getTime() + 2 * limits.windowMs),
          },
        },
        { upsert: true },
      );
    try {
      await update();
    } catch (error) {
      // Two concurrent first failures can race on the unique bucket; the loser retries as an increment.
      if (!(error instanceof MongoServerError && error.code === 11000)) throw error;
      await update();
    }
  }
}
