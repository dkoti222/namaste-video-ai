import { createHmac, timingSafeEqual } from "node:crypto";
import { ApiError } from "./http";

// Opaque, versioned, HMAC-signed list cursors bound to owner, route and filter (API_DESIGN.md section 2.3).

const TTL_MS = 24 * 60 * 60_000;
const invalid = () => new ApiError(400, "INVALID_CURSOR", "This list position is no longer valid. Reload the list.");

type Binding = { ownerId: string; route: string; filter: string };
export type Position = { sortMs: number; id: string };

const keyFor = (secret: string) => createHmac("sha256", secret).update("namastevideo:cursor:v1").digest();
const ownerTag = (secret: string, ownerId: string) => createHmac("sha256", keyFor(secret)).update(`owner:${ownerId}`).digest("base64url").slice(0, 22);

export function encodeCursor(secret: string, binding: Binding, position: Position, now = Date.now()): string {
  const payload = Buffer.from(
    JSON.stringify({ v: 1, o: ownerTag(secret, binding.ownerId), r: binding.route, f: binding.filter, s: position.sortMs, i: position.id, e: now + TTL_MS }),
  ).toString("base64url");
  const signature = createHmac("sha256", keyFor(secret)).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function decodeCursor(secret: string, binding: Binding, cursor: string, now = Date.now()): Position {
  if (cursor.length > 2048) throw invalid();
  const [payload, signature, extra] = cursor.split(".");
  if (!payload || !signature || extra !== undefined) throw invalid();
  const expected = createHmac("sha256", keyFor(secret)).update(payload).digest();
  const given = Buffer.from(signature, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw invalid();
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    throw invalid();
  }
  if (
    data.v !== 1 ||
    data.o !== ownerTag(secret, binding.ownerId) ||
    data.r !== binding.route ||
    data.f !== binding.filter ||
    typeof data.e !== "number" ||
    data.e < now ||
    typeof data.s !== "number" ||
    typeof data.i !== "string"
  ) {
    throw invalid();
  }
  return { sortMs: data.s, id: data.i };
}
