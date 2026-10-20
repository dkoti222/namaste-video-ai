import type { ClientSession, Db } from "mongodb";
import { canonicalJson, sha256Hex } from "../lib/canonical";
import { newId } from "./db/migrations";
import { ApiError } from "./http";

// Idempotent command receipts (API_DESIGN.md section 2.4, DB_DESIGN.md section 5.6). A receipt commits in the same
// transaction as the domain records it describes, so an uncommitted command is never visible.

const KEY_PATTERN = /^[\x21-\x7e]{16,128}$/;

export type CommandIdentity = { ownerId: string; scope: string; idempotencyKey: string; requestHash: string };
export type Receipt = { responseStatus: number; responseBody: Record<string, unknown>; resourceIds: string[] };

export function commandIdentity(request: Request, ownerId: string, scopePath: string, body: unknown): CommandIdentity {
  const idempotencyKey = request.headers.get("idempotency-key") ?? "";
  if (!KEY_PATTERN.test(idempotencyKey)) {
    throw new ApiError(422, "VALIDATION_FAILED", "Please correct the highlighted fields.", {
      fieldErrors: [{ path: "Idempotency-Key", code: "INVALID", message: "Send a random Idempotency-Key of 16-128 printable characters." }],
    });
  }
  const scope = `${request.method.toUpperCase()} ${scopePath}`;
  return { ownerId, scope, idempotencyKey, requestHash: sha256Hex(canonicalJson({ scope, body })) };
}

/** Returns the earlier accepted receipt for this key, or null. A different request under the same key is rejected. */
export async function findReceipt(db: Db, identity: CommandIdentity): Promise<Receipt | null> {
  const receipt = await db
    .collection("commands")
    .findOne({ ownerId: identity.ownerId, scope: identity.scope, idempotencyKey: identity.idempotencyKey });
  if (!receipt) return null;
  if (receipt.requestHash !== identity.requestHash) {
    throw new ApiError(409, "IDEMPOTENCY_KEY_REUSED", "This request key was already used for a different request. Use a new key.");
  }
  return { responseStatus: receipt.responseStatus, responseBody: receipt.responseBody, resourceIds: receipt.resourceIds };
}

export async function insertReceipt(
  db: Db,
  session: ClientSession,
  identity: CommandIdentity,
  receipt: Receipt & { projectId?: string },
  now: Date,
): Promise<void> {
  await db.collection("commands").insertOne(
    {
      _id: newId("cmd") as never,
      schemaVersion: 1,
      ownerId: identity.ownerId,
      ...(receipt.projectId ? { projectId: receipt.projectId } : {}),
      scope: identity.scope,
      idempotencyKey: identity.idempotencyKey,
      requestHash: identity.requestHash,
      state: "accepted",
      responseStatus: receipt.responseStatus,
      responseBody: receipt.responseBody,
      resourceIds: receipt.resourceIds,
      createdAt: now,
      updatedAt: now,
    },
    { session },
  );
}
