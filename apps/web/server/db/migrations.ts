import { randomBytes } from "node:crypto";
import { canonicalJson, sha256Hex as sha256 } from "../../lib/canonical";
import { Long, MongoServerError, type Collection, type Db, type Document } from "mongodb";
import { AUTH_COLLECTIONS, COLLECTIONS, collectionSpec, type CollectionSpec, type IndexedCollection, type IndexSpec } from "./schema";

// Operator-run migrations (DB_DESIGN.md section 13): immutable name + checksum, lease with fence, recorded state.
// Never run these from web requests.

export class MigrationChecksumError extends Error {
  override name = "MigrationChecksumError";
}
export class MigrationInProgressError extends Error {
  override name = "MigrationInProgressError";
}
export class SchemaConflictError extends Error {
  override name = "SchemaConflictError";
}

export type Migration = { name: string; checksum: string; apply: (db: Db) => Promise<void> };
export type MigrationOutcome = { name: string; outcome: "applied" | "already_applied" };

export { canonicalJson };

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(18).toString("base64url")}`;
}

export function migrationChecksum(name: string, collections: readonly IndexedCollection[]): string {
  return sha256(canonicalJson({ name, collections }));
}

const INITIAL = "0001-initial-collections";
const AUTH_INDEXES = "0002-auth-indexes";
export const MIGRATIONS: readonly Migration[] = [
  { name: INITIAL, checksum: migrationChecksum(INITIAL, COLLECTIONS), apply: (db) => ensureCollections(db, COLLECTIONS) },
  { name: AUTH_INDEXES, checksum: migrationChecksum(AUTH_INDEXES, AUTH_COLLECTIONS), apply: (db) => ensureIndexedCollections(db, AUTH_COLLECTIONS) },
];

const STRICT = { validationLevel: "strict", validationAction: "error" } as const;
const NAMESPACE_EXISTS = 48;
const INDEX_CONFLICT_CODES = new Set([85, 86]); // IndexOptionsConflict, IndexKeySpecsConflict
const DUPLICATE_KEY = 11000;

export async function ensureCollections(db: Db, specs: readonly CollectionSpec[]): Promise<void> {
  for (const spec of specs) {
    await ensureCollection(db, spec);
    await ensureIndexes(db.collection(spec.name), spec);
  }
}

/** Collections whose document format is owned elsewhere (Better Auth): create if missing, add indexes, no validator. */
export async function ensureIndexedCollections(db: Db, specs: readonly IndexedCollection[]): Promise<void> {
  for (const spec of specs) {
    const exists = (await db.listCollections({ name: spec.name }, { nameOnly: true }).toArray()).length > 0;
    if (!exists) {
      try {
        await db.createCollection(spec.name);
      } catch (error) {
        if (!(error instanceof MongoServerError && error.code === NAMESPACE_EXISTS)) throw error;
      }
    }
    await ensureIndexes(db.collection(spec.name), spec);
  }
}

async function ensureCollection(db: Db, spec: CollectionSpec): Promise<void> {
  const exists = (await db.listCollections({ name: spec.name }, { nameOnly: true }).toArray()).length > 0;
  if (!exists) {
    try {
      await db.createCollection(spec.name, { validator: spec.validator, ...STRICT });
      return;
    } catch (error) {
      if (!(error instanceof MongoServerError && error.code === NAMESPACE_EXISTS)) throw error;
    }
  }
  await db.command({ collMod: spec.name, validator: spec.validator, ...STRICT });
}

const indexShape = (index: { key: Document; unique?: boolean; partialFilterExpression?: Document; expireAfterSeconds?: number }) =>
  canonicalJson({
    key: Object.entries(index.key), // key order is significant
    unique: index.unique === true,
    partialFilterExpression: index.partialFilterExpression ?? null,
    expireAfterSeconds: index.expireAfterSeconds ?? null,
  });

async function ensureIndexes(collection: Collection, spec: IndexedCollection): Promise<void> {
  const existing = await collection.listIndexes().toArray();
  for (const index of spec.indexes) {
    const found = existing.find((candidate) => candidate.name === index.name);
    if (found) {
      if (indexShape(found as Parameters<typeof indexShape>[0]) !== indexShape(index)) {
        throw new SchemaConflictError(
          `Index ${spec.name}.${index.name} exists with different keys or options. Resolve it explicitly; migrations never drop indexes.`,
        );
      }
      continue;
    }
    try {
      await collection.createIndex(index.key, indexOptions(index));
    } catch (error) {
      if (error instanceof MongoServerError && INDEX_CONFLICT_CODES.has(Number(error.code))) {
        throw new SchemaConflictError(`Index ${spec.name}.${index.name} conflicts with an existing index: ${error.message}`);
      }
      if (error instanceof MongoServerError && error.code === DUPLICATE_KEY) {
        throw new SchemaConflictError(`Index ${spec.name}.${index.name} cannot be created: existing documents violate uniqueness.`);
      }
      throw error;
    }
  }
}

function indexOptions(index: IndexSpec) {
  return {
    name: index.name,
    ...(index.unique ? { unique: true } : {}),
    ...(index.partialFilterExpression ? { partialFilterExpression: index.partialFilterExpression } : {}),
    ...(index.expireAfterSeconds === undefined ? {} : { expireAfterSeconds: index.expireAfterSeconds }),
  };
}

function errorCode(error: unknown): string {
  if (error instanceof SchemaConflictError) return "SCHEMA_CONFLICT";
  if (error instanceof MongoServerError) return `MONGO_${String(error.code ?? error.codeName ?? "ERROR").slice(0, 60)}`;
  return "MIGRATION_FAILED";
}

export async function runMigrations(
  db: Db,
  { migrations = MIGRATIONS, leaseMs = 10 * 60_000 }: { migrations?: readonly Migration[]; leaseMs?: number } = {},
): Promise<MigrationOutcome[]> {
  // The ledger itself is bootstrapped idempotently before any lease can be recorded.
  await ensureCollections(db, [collectionSpec("schemaMigrations")]);
  const outcomes: MigrationOutcome[] = [];
  for (const migration of migrations) outcomes.push({ name: migration.name, outcome: await runOne(db, migration, leaseMs) });
  return outcomes;
}

async function runOne(db: Db, migration: Migration, leaseMs: number): Promise<MigrationOutcome["outcome"]> {
  const ledger = db.collection("schemaMigrations");
  const record = await ledger.findOne({ migrationName: migration.name });
  if (record && record.checksum !== migration.checksum) {
    throw new MigrationChecksumError(
      `Migration ${migration.name} was recorded with a different checksum. Applied migrations are immutable; add a new migration instead.`,
    );
  }
  if (record?.state === "completed") return "already_applied";

  const holder = newId("mig");
  const now = new Date();
  const until = new Date(now.getTime() + leaseMs);
  let fence: Long;
  if (!record) {
    fence = Long.fromNumber(1);
    try {
      await ledger.insertOne({
        _id: newId("mig") as never,
        schemaVersion: 1,
        migrationName: migration.name,
        checksum: migration.checksum,
        state: "running",
        lease: { holder, until, fence },
        createdAt: now,
        updatedAt: now,
      });
    } catch (error) {
      if (error instanceof MongoServerError && error.code === DUPLICATE_KEY) {
        throw new MigrationInProgressError(`Migration ${migration.name} is being applied by another operator.`);
      }
      throw error;
    }
  } else {
    // Take over only a failed or abandoned run, and only if the fence has not moved since it was read.
    fence = Long.fromValue(record.lease?.fence ?? 0).add(1);
    const guard = record.lease
      ? { "lease.fence": record.lease.fence, "lease.until": { $lt: now } }
      : { lease: { $exists: false } };
    const claimed = await ledger.updateOne(
      { _id: record._id, state: { $ne: "completed" }, ...guard },
      { $set: { state: "running", lease: { holder, until, fence }, updatedAt: now }, $unset: { errorCode: "" } },
    );
    if (claimed.modifiedCount !== 1) {
      throw new MigrationInProgressError(`Migration ${migration.name} is being applied by another operator.`);
    }
  }

  const owned = { migrationName: migration.name, "lease.holder": holder, "lease.fence": fence };
  try {
    await migration.apply(db);
  } catch (error) {
    await ledger.updateOne(owned, {
      $set: { state: "failed", errorCode: errorCode(error), "lease.until": new Date(), updatedAt: new Date() },
    });
    throw error;
  }
  const finished = await ledger.updateOne(owned, { $set: { state: "completed", "lease.until": new Date(), updatedAt: new Date() } });
  if (finished.modifiedCount !== 1) {
    throw new MigrationInProgressError(`Migration ${migration.name} lost its lease before completion; rerun to verify.`);
  }
  return "applied";
}

export type SchemaReport = { ok: boolean; problems: string[]; unexpectedIndexes: string[] };

/** Read-only comparison of the live database against the declared schema and migration ledger. */
export async function verifySchema(
  db: Db,
  specs: readonly CollectionSpec[] = COLLECTIONS,
  indexedOnly: readonly IndexedCollection[] = AUTH_COLLECTIONS,
): Promise<SchemaReport> {
  const problems: string[] = [];
  const unexpectedIndexes: string[] = [];
  const live = new Map((await db.listCollections({}, { nameOnly: false }).toArray()).map((info) => [info.name, info]));

  for (const spec of specs) {
    const info = live.get(spec.name) as (Document & { options?: Document }) | undefined;
    if (!info) {
      problems.push(`Missing collection ${spec.name}`);
      continue;
    }
    const options = info.options ?? {};
    if (canonicalJson(options.validator ?? null) !== canonicalJson(spec.validator)) problems.push(`Validator differs on ${spec.name}`);
    if (options.validationLevel !== "strict" || options.validationAction !== "error") {
      problems.push(`Validation on ${spec.name} is not strict/error`);
    }
    const indexes = await db.collection(spec.name).listIndexes().toArray();
    for (const index of spec.indexes) {
      const found = indexes.find((candidate) => candidate.name === index.name);
      if (!found) problems.push(`Missing index ${spec.name}.${index.name}`);
      else if (indexShape(found as Parameters<typeof indexShape>[0]) !== indexShape(index)) {
        problems.push(`Index ${spec.name}.${index.name} differs from the catalog`);
      }
    }
    for (const index of indexes) {
      if (index.name !== "_id_" && !spec.indexes.some((expected) => expected.name === index.name)) {
        unexpectedIndexes.push(`${spec.name}.${index.name}`);
      }
    }
  }

  for (const spec of indexedOnly) {
    if (!live.has(spec.name)) {
      problems.push(`Missing collection ${spec.name}`);
      continue;
    }
    const indexes = await db.collection(spec.name).listIndexes().toArray();
    for (const index of spec.indexes) {
      const found = indexes.find((candidate) => candidate.name === index.name);
      if (!found) problems.push(`Missing index ${spec.name}.${index.name}`);
      else if (indexShape(found as Parameters<typeof indexShape>[0]) !== indexShape(index)) {
        problems.push(`Index ${spec.name}.${index.name} differs from the catalog`);
      }
    }
  }

  if (live.has("schemaMigrations")) {
    for (const migration of MIGRATIONS) {
      const record = await db.collection("schemaMigrations").findOne({ migrationName: migration.name });
      if (!record) problems.push(`Migration ${migration.name} has not been applied`);
      else if (record.checksum !== migration.checksum) problems.push(`Migration ${migration.name} checksum differs`);
      else if (record.state !== "completed") problems.push(`Migration ${migration.name} is ${record.state}`);
    }
  }

  return { ok: problems.length === 0, problems, unexpectedIndexes };
}
