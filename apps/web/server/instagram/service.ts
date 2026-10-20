import { randomBytes } from "node:crypto";
import { Long, type Db } from "mongodb";
import { z } from "zod";
import { sha256Hex } from "../../lib/canonical";
import type { AuthServices } from "../auth/auth";
import { findReceipt, insertReceipt, type CommandIdentity } from "../commands";
import { inTransaction } from "../jobs/core";
import { newId } from "../db/migrations";
import { ApiError } from "../http";
import { INSTAGRAM_SCOPES, readInstagramConfig, type InstagramConfig } from "./config";
import { decryptToken, encryptToken, type EncryptedSecret } from "./crypto";
import { mediaPublicOrigin } from "../publish/media-origin";
import { getInstagramProvider, InstagramProviderError, type InstagramProvider } from "./provider";

// I01–I04 (API_DESIGN.md section 9; DB_DESIGN.md T11/T12). OAuth state is random, session-bound, single use and
// valid for ten minutes. Tokens are exchanged outside transactions, encrypted at rest and never returned.

export const STATE_TTL_MS = 10 * 60_000;
/** Show "expiring" this long before the provider expiry; the refresh job runs well before it. */
const EXPIRING_WINDOW_MS = 7 * 24 * 60 * 60_000;
/** Refresh tokens expiring within this window. Long-lived tokens last about 60 days and must be at least 24 hours old
 * to refresh, which a token this close to expiry always is. */
export const REFRESH_WINDOW_MS = 20 * 24 * 60 * 60_000;

export type ConnectionState = "connected" | "expiring" | "reconnect_required" | "disconnected";
export type ConnectionView = {
  id: string;
  revision: number;
  state: ConnectionState;
  account: { id: string; username: string; type: "BUSINESS" | "CREATOR" } | null;
  destinationEpoch: number;
  expiresAt: string | null;
  publishingAvailable: boolean;
  pendingIntentCount: number;
};

/** Opaque outcomes for the redirect after the callback (never provider text). */
export type ConnectOutcome = "connected" | "cancelled" | "failed" | "expired" | "unsupported_account" | "missing_permissions" | "account_in_use" | "reconciliation_pending" | "session_lost";

export const connectBody = z.object({ returnProjectId: z.string().regex(/^[a-z]{2,8}_[A-Za-z0-9_-]{16,64}$/).optional() }).strict();
export const disconnectBody = z.object({ expectedRevision: z.number().int().min(1), confirmPausePending: z.literal(true) }).strict();

const connections = (db: Db) => db.collection("instagramConnections");
const states = (db: Db) => db.collection("oauthStates");
const UNRESOLVED_SUBMITTED = ["submitting", "processing", "outcome_unknown"];
const PAUSABLE = ["scheduled", "queued"];

export function requireInstagramConfig(): InstagramConfig {
  const config = readInstagramConfig();
  if (!config) throw new ApiError(503, "INTEGRATION_UNAVAILABLE", "Instagram connection isn’t set up on this server yet.", { retryable: false });
  return config;
}

async function pendingIntentCount(db: Db, ownerId: string): Promise<number> {
  return db.collection("publishIntents").countDocuments({ ownerId, unresolved: true });
}

export function toConnectionView(doc: Record<string, unknown>, pending: number, now = new Date()): ConnectionView {
  const expiresAt = doc.expiresAt instanceof Date ? doc.expiresAt : null;
  let state = doc.state as ConnectionState;
  if (state === "connected" || state === "expiring") {
    if (expiresAt && expiresAt.getTime() <= now.getTime()) state = "reconnect_required";
    else if (expiresAt && expiresAt.getTime() - now.getTime() < EXPIRING_WINDOW_MS) state = "expiring";
    else state = "connected";
  }
  const hasAccount = typeof doc.instagramUserId === "string" && typeof doc.username === "string";
  return {
    id: String(doc._id),
    revision: Number(doc.revision),
    state,
    account: hasAccount && state !== "disconnected" ? { id: String(doc.instagramUserId), username: String(doc.username), type: doc.accountType === "BUSINESS" ? "BUSINESS" : "CREATOR" } : null,
    destinationEpoch: Number(doc.destinationEpoch),
    expiresAt: expiresAt && state !== "disconnected" ? expiresAt.toISOString() : null,
    // Posting also needs a public media link Instagram can fetch (F19).
    publishingAvailable: (state === "connected" || state === "expiring") && hasAccount && mediaPublicOrigin() !== null,
    pendingIntentCount: pending,
  };
}

/** I03 */
export async function getConnection(db: Db, ownerId: string): Promise<ConnectionView | null> {
  const doc = await connections(db).findOne({ ownerId });
  if (!doc) return null;
  return toConnectionView(doc, await pendingIntentCount(db, ownerId));
}

/** I01: creates the one-use state and returns the allowlisted provider URL (excluded from command receipts). */
export async function startConnect(db: Db, owner: { ownerId: string; sessionHash: string }, body: z.infer<typeof connectBody>, provider?: InstagramProvider) {
  const config = requireInstagramConfig();
  if (body.returnProjectId) {
    const project = await db.collection("projects").findOne({ _id: body.returnProjectId as never, ownerId: owner.ownerId, deletedAt: null }, { projection: { _id: 1 } });
    if (!project) throw new ApiError(404, "NOT_FOUND", "This item is unavailable.");
  }
  const state = randomBytes(32).toString("base64url");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + STATE_TTL_MS);
  await states(db).insertOne({
    _id: newId("oas") as never,
    schemaVersion: 1,
    ownerId: owner.ownerId,
    stateHash: sha256Hex(`oauth:${state}`),
    initiatingSessionHash: owner.sessionHash,
    ...(body.returnProjectId ? { returnProjectId: body.returnProjectId } : {}),
    state: "pending",
    expiresAt,
    createdAt: now,
    updatedAt: now,
  });
  return { authorizationUrl: (provider ?? getInstagramProvider(config)).authorizationUrl(state), expiresAt: expiresAt.toISOString() };
}

/** Server-generated relative return route (never from the provider or the client). */
export function returnPath(outcome: ConnectOutcome, returnProjectId?: string | null): string {
  const base = returnProjectId ? `/projects/${returnProjectId}/video` : "/settings";
  return `${base}?instagram=${outcome}`;
}

type CallbackInput = { code: string | null; state: string | null; error: string | null };

/**
 * I02 / T11+T12. `owner` is null when the browser has no valid session: nothing is attached and the user restarts
 * Connect after signing in. Returns the relative path to redirect to.
 */
export async function completeConnect(services: Pick<AuthServices, "db" | "client">, owner: { ownerId: string; sessionHash: string } | null, input: CallbackInput, provider?: InstagramProvider): Promise<string> {
  const { db, client } = services;
  if (!owner) return returnPath("session_lost");
  if (!input.state || input.state.length > 200) return returnPath("failed");
  const config = readInstagramConfig();
  if (!config) return returnPath("failed");
  const now = new Date();

  // T11: atomic claim pending → exchanging, bound to this owner and sign-in, unexpired.
  const claimed = await states(db).findOneAndUpdate(
    { stateHash: sha256Hex(`oauth:${input.state}`), ownerId: owner.ownerId, initiatingSessionHash: owner.sessionHash, state: "pending", expiresAt: { $gt: now } },
    { $set: { state: "exchanging", updatedAt: now } },
    { returnDocument: "after" },
  );
  if (!claimed) {
    const known = await states(db).findOne({ stateHash: sha256Hex(`oauth:${input.state}`), ownerId: owner.ownerId }, { projection: { returnProjectId: 1, expiresAt: 1 } });
    const expired = known && known.expiresAt instanceof Date && known.expiresAt.getTime() <= now.getTime();
    return returnPath(expired ? "expired" : "failed", known?.returnProjectId as string | undefined);
  }
  const returnProjectId = (claimed.returnProjectId as string | undefined) ?? null;
  const fail = async (outcome: ConnectOutcome) => {
    await states(db).updateOne({ _id: claimed._id, state: "exchanging" }, { $set: { state: "failed", consumedAt: new Date(), updatedAt: new Date() } });
    return returnPath(outcome, returnProjectId);
  };

  if (input.error || !input.code) return fail(input.error === "access_denied" ? "cancelled" : "failed");

  // Network exchange outside any transaction; a crash here leaves the state "exchanging" → user restarts Connect.
  const adapter = provider ?? getInstagramProvider(config);
  let token: { accessToken: string; expiresAt: Date | null };
  let account: Awaited<ReturnType<InstagramProvider["account"]>>;
  let permissions: string[];
  try {
    const exchanged = await adapter.exchangeCode(input.code.replace(/#_$/, ""));
    permissions = exchanged.permissions;
    const longLived = await adapter.longLivedToken(exchanged.accessToken);
    token = { accessToken: longLived.accessToken, expiresAt: longLived.expiresInSeconds ? new Date(Date.now() + longLived.expiresInSeconds * 1000) : null };
    account = await adapter.account(token.accessToken);
  } catch (error) {
    if (!(error instanceof InstagramProviderError)) console.error("[instagram] unexpected exchange error", error instanceof Error ? error.name : "unknown");
    return fail("failed");
  }
  if (!INSTAGRAM_SCOPES.every((scope) => permissions.includes(scope))) return fail("missing_permissions");
  if (account.accountType === "UNSUPPORTED") return fail("unsupported_account");
  const accountType = account.accountType;

  // T12: eligible unique account, no conflicting unresolved old submission; connection upsert + state consumed.
  let outcome: ConnectOutcome = "connected";
  try {
    await inTransaction(client, async (session) => {
      const reserved = await connections(db).findOne({ instagramUserId: account.userId, ownerId: { $ne: owner.ownerId } }, { session, projection: { _id: 1 } });
      if (reserved) {
        outcome = "account_in_use";
        return;
      }
      const existing = await connections(db).findOne({ ownerId: owner.ownerId }, { session });
      const at = new Date();
      const scopes = [...INSTAGRAM_SCOPES];
      if (!existing) {
        const id = newId("igc");
        await connections(db).insertOne(
          {
            _id: id as never,
            schemaVersion: 1,
            ownerId: owner.ownerId,
            revision: 1,
            state: "connected",
            instagramUserId: account.userId,
            username: account.username,
            accountType,
            scopes,
            encryptedToken: encryptToken(config, owner.ownerId, id, token.accessToken),
            ...(token.expiresAt ? { expiresAt: token.expiresAt } : {}),
            tokenRevision: 1,
            destinationEpoch: 1,
            reconciliationOnly: false,
            createdAt: at,
            updatedAt: at,
          },
          { session },
        );
      } else {
        const id = String(existing._id);
        const previousAccount = typeof existing.instagramUserId === "string" ? existing.instagramUserId : null;
        const sameAccount = previousAccount === account.userId;
        if (previousAccount && !sameAccount) {
          const unresolved = await db.collection("publishIntents").countDocuments({ ownerId: owner.ownerId, instagramUserId: previousAccount, unresolved: true, state: { $in: UNRESOLVED_SUBMITTED } }, { session });
          if (unresolved > 0) {
            outcome = "reconciliation_pending";
            return;
          }
          // A different destination: pending (unsubmitted) posts for the old account need explicit re-approval.
          await db.collection("publishIntents").updateMany(
            { ownerId: owner.ownerId, instagramUserId: previousAccount, unresolved: true, state: { $in: PAUSABLE }, claim: { $exists: false } },
            { $set: { state: "paused_auth", updatedAt: at }, $inc: { revision: 1 } },
            { session },
          );
        }
        await connections(db).updateOne(
          { _id: existing._id },
          {
            $set: {
              state: "connected",
              instagramUserId: account.userId,
              username: account.username,
              accountType,
              scopes,
              encryptedToken: encryptToken(config, owner.ownerId, id, token.accessToken),
              reconciliationOnly: false,
              updatedAt: at,
              ...(token.expiresAt ? { expiresAt: token.expiresAt } : {}),
            },
            ...(token.expiresAt ? {} : { $unset: { expiresAt: "" } }),
            $inc: { revision: 1, tokenRevision: 1, ...(previousAccount && !sameAccount ? { destinationEpoch: 1 } : {}) },
          },
          { session },
        );
      }
      await states(db).updateOne({ _id: claimed._id }, { $set: { state: "consumed", consumedAt: at, updatedAt: at } }, { session });
    });
  } catch (error) {
    // connection_account unique index: another owner reserved this account concurrently.
    if ((error as { code?: number }).code !== 11000) throw error;
    outcome = "account_in_use";
  }
  if (outcome !== "connected") return fail(outcome);
  return returnPath("connected", returnProjectId);
}

/**
 * I04 (K): stops new publishing. Keeps encrypted credentials only while submitted posts still need reconciliation.
 * The destination epoch always advances, so anything approved for the old connection needs fresh approval.
 */
export async function disconnect(services: Pick<AuthServices, "db" | "client">, identity: CommandIdentity, body: z.infer<typeof disconnectBody>) {
  const { db, client } = services;
  const prior = await findReceipt(db, identity);
  if (prior) return { result: prior.responseBody as { connection: ConnectionView; pausedIntentCount: number; reconciliationPending: boolean }, replayed: true };
  const { ownerId } = identity;
  const existing = await connections(db).findOne({ ownerId });
  if (!existing) throw new ApiError(404, "NOT_FOUND", "There’s no Instagram connection to disconnect.");
  if (Number(existing.revision) !== body.expectedRevision) {
    throw new ApiError(409, "REVISION_CONFLICT", "Your Instagram connection changed in another tab. Reload to see the latest.", { details: { currentRevision: Number(existing.revision) } });
  }
  let result!: { connection: ConnectionView; pausedIntentCount: number; reconciliationPending: boolean };
  await inTransaction(client, async (session) => {
    const at = new Date();
    const account = typeof existing.instagramUserId === "string" ? existing.instagramUserId : null;
    const unresolved = account ? await db.collection("publishIntents").countDocuments({ ownerId, instagramUserId: account, unresolved: true, state: { $in: UNRESOLVED_SUBMITTED } }, { session }) : 0;
    const paused = account
      ? await db.collection("publishIntents").updateMany(
          { ownerId, instagramUserId: account, unresolved: true, state: { $in: PAUSABLE }, claim: { $exists: false } },
          { $set: { state: "paused_auth", updatedAt: at }, $inc: { revision: 1 } },
          { session },
        )
      : { modifiedCount: 0 };
    const reconciliationPending = unresolved > 0;
    const updated = await connections(db).findOneAndUpdate(
      { _id: existing._id, revision: body.expectedRevision },
      reconciliationPending
        ? { $set: { state: "disconnected", reconciliationOnly: true, updatedAt: at }, $inc: { revision: 1, destinationEpoch: 1 } }
        : { $set: { state: "disconnected", reconciliationOnly: false, scopes: [], updatedAt: at }, $unset: { encryptedToken: "", instagramUserId: "", username: "", accountType: "", expiresAt: "", refreshLease: "" }, $inc: { revision: 1, destinationEpoch: 1 } },
      { session, returnDocument: "after" },
    );
    if (!updated) throw new ApiError(409, "REVISION_CONFLICT", "Your Instagram connection changed in another tab. Reload to see the latest.");
    result = { connection: toConnectionView(updated, await pendingIntentCount(db, ownerId)), pausedIntentCount: paused.modifiedCount, reconciliationPending };
    await insertReceipt(db, session, identity, { responseStatus: 200, responseBody: result, resourceIds: [String(existing._id)] }, at);
  });
  return { result, replayed: false };
}

/**
 * Refreshes one connection's long-lived token under a lease and token-revision CAS. Failure marks the connection
 * reconnect_required only when the provider rejects the token (not on transient outages).
 */
export async function refreshConnection(db: Db, connectionId: string, provider?: InstagramProvider): Promise<"refreshed" | "skipped" | "rejected" | "unavailable"> {
  const config = readInstagramConfig();
  if (!config) return "skipped";
  const now = new Date();
  const holder = newId("lse");
  const doc = await connections(db).findOneAndUpdate(
    {
      _id: connectionId as never,
      state: { $in: ["connected", "expiring"] },
      encryptedToken: { $exists: true },
      reconciliationOnly: false,
      $or: [{ refreshLease: { $exists: false } }, { "refreshLease.until": { $lt: now } }],
    },
    { $set: { refreshLease: { holder, until: new Date(now.getTime() + 2 * 60_000), fence: Long.fromNumber(Date.now()) } } },
    { returnDocument: "after" },
  );
  if (!doc) return "skipped";
  const release = { $unset: { refreshLease: "" } };
  const ownerId = String(doc.ownerId);
  let grant;
  try {
    const current = decryptToken(config, ownerId, connectionId, doc.encryptedToken as EncryptedSecret);
    grant = await (provider ?? getInstagramProvider(config)).refreshToken(current);
  } catch (error) {
    const rejected = error instanceof InstagramProviderError && error.code === "PROVIDER_REJECTED";
    await connections(db).updateOne(
      { _id: doc._id, "refreshLease.holder": holder },
      rejected ? { $set: { state: "reconnect_required", updatedAt: new Date() }, $inc: { revision: 1 }, ...release } : release,
    );
    return rejected ? "rejected" : "unavailable";
  }
  const at = new Date();
  await connections(db).updateOne(
    { _id: doc._id, "refreshLease.holder": holder, tokenRevision: doc.tokenRevision },
    {
      $set: { encryptedToken: encryptToken(config, ownerId, connectionId, grant.accessToken), state: "connected", updatedAt: at, ...(grant.expiresInSeconds ? { expiresAt: new Date(at.getTime() + grant.expiresInSeconds * 1000) } : {}) },
      $inc: { tokenRevision: 1, revision: 1 },
      ...release,
    },
  );
  return "refreshed";
}

/** Cron: refresh connections whose tokens expire within the refresh window. */
export async function refreshDueConnections(db: Db, provider?: InstagramProvider, limit = 50) {
  const due = await connections(db)
    .find({ state: { $in: ["connected", "expiring"] }, reconciliationOnly: false, expiresAt: { $lt: new Date(Date.now() + REFRESH_WINDOW_MS) } }, { projection: { _id: 1 } })
    .limit(limit)
    .toArray();
  const results: Record<string, number> = {};
  for (const { _id } of due) {
    const outcome = await refreshConnection(db, String(_id), provider);
    results[outcome] = (results[outcome] ?? 0) + 1;
  }
  return results;
}
