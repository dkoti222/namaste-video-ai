// Integration tests against a real single-node replica set: real validators, indexes and transactions.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { Long, MongoClient, MongoServerError, type Db } from "mongodb";
import { DatabaseConfigError, readDatabaseConfig, redactConnectionStrings } from "../server/db/config";
import { describeDeployment } from "../server/db/client";
import {
  MIGRATIONS,
  MigrationChecksumError,
  MigrationInProgressError,
  SchemaConflictError,
  newId,
  runMigrations,
  verifySchema,
} from "../server/db/migrations";
import { AUTH_COLLECTIONS, COLLECTIONS } from "../server/db/schema";

let replSet: MongoMemoryReplSet;
let client: MongoClient;
let dbCounter = 0;

before(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  client = await new MongoClient(replSet.getUri()).connect();
});
after(async () => {
  await client?.close();
  await replSet?.stop();
});

const freshDb = (): Db => client.db(`f02_test_${process.pid}_${++dbCounter}`);
const migratedDb = async () => {
  const db = freshDb();
  await runMigrations(db);
  return db;
};
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const isValidationError = (error: unknown) => error instanceof MongoServerError && error.code === 121;
const isDuplicateKey = (error: unknown) => error instanceof MongoServerError && error.code === 11000;
const stamps = () => ({ schemaVersion: 1, createdAt: new Date(), updatedAt: new Date() });

function project(ownerId = "user-a") {
  return {
    _id: newId("prj"),
    ...stamps(),
    ownerId,
    title: "Binary search",
    revision: 1,
    draftRevision: 1,
    conversationId: newId("cnv"),
    deletedAt: null,
    flags: { drafts: true, ready: false, scheduled: false, published: false, needsAttention: false },
    contentRevision: Long.fromNumber(1),
  };
}

function job(projectId: string, overrides: Record<string, unknown> = {}) {
  return {
    _id: newId("job"),
    ...stamps(),
    ownerId: "user-a",
    projectId,
    type: "storyboard",
    state: "queued",
    revision: 1,
    stage: "queued",
    inputSnapshot: { topic: "Binary search" },
    inputHash: hash("input"),
    executionAttempt: 1,
    progress: {},
    deadlineAt: new Date(Date.now() + 60_000),
    activeSlot: true,
    ...overrides,
  };
}

test("configuration fails clearly without leaking connection strings", () => {
  assert.throws(() => readDatabaseConfig({}), (error: unknown) => error instanceof DatabaseConfigError && /MONGODB_URI/.test(error.message));
  assert.throws(() => readDatabaseConfig({ MONGODB_URI: "mongodb://localhost" }), /MONGODB_DB_NAME/);
  assert.throws(() => readDatabaseConfig({ MONGODB_URI: "postgres://x", MONGODB_DB_NAME: "dev" }), /must start with mongodb/);
  assert.throws(() => readDatabaseConfig({ MONGODB_URI: "mongodb://localhost", MONGODB_DB_NAME: "admin" }), /must not be admin/);
  assert.throws(() => readDatabaseConfig({ MONGODB_URI: "mongodb://h", MONGODB_DB_NAME: "dev", MONGODB_MAX_POOL_SIZE: "0" }), /POOL_SIZE/);
  const secret = "mongodb+srv://user:hunter2@cluster0.example.mongodb.net/?retryWrites=true";
  try {
    readDatabaseConfig({ MONGODB_URI: secret });
  } catch (error) {
    assert.ok(!String((error as Error).message).includes("hunter2"));
  }
  assert.equal(redactConnectionStrings(`failed to reach ${secret} now`), "failed to reach mongodb://[redacted] now");

  const migration = readDatabaseConfig(
    { MONGODB_URI: "mongodb://app", MONGODB_MIGRATION_URI: "mongodb://operator", MONGODB_DB_NAME: "namastevideo_dev" },
    "migration",
  );
  assert.deepEqual([migration.uri, migration.uriSource, migration.maxPoolSize], ["mongodb://operator", "MONGODB_MIGRATION_URI", 10]);
  assert.equal(readDatabaseConfig({ MONGODB_URI: "mongodb://app", MONGODB_MIGRATION_URI: "mongodb://operator", MONGODB_DB_NAME: "d" }).uri, "mongodb://app");
});

test("deployment supports transactions", async () => {
  const info = await describeDeployment(freshDb());
  assert.equal(info.transactions, true);
  assert.ok(info.replicaSet);
});

test("migration creates every collection with strict validators and the full named index catalog", async () => {
  const db = freshDb();
  assert.deepEqual(await runMigrations(db), [
    { name: "0001-initial-collections", outcome: "applied" },
    { name: "0002-auth-indexes", outcome: "applied" },
  ]);
  const report = await verifySchema(db);
  assert.deepEqual(report, { ok: true, problems: [], unexpectedIndexes: [] });

  const names = (await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name).sort();
  assert.deepEqual(names, [...COLLECTIONS, ...AUTH_COLLECTIONS].map((c) => c.name).sort());
  assert.equal(COLLECTIONS.length, 28);
  const indexCount = COLLECTIONS.reduce((total, c) => total + c.indexes.length, 0);
  assert.equal(indexCount, 66); // 56 catalog rows with five project_flag_* indexes, plus six cleanup indexes
  const ttl = await db.collection("oauthStates").indexes();
  assert.equal(ttl.find((i) => i.name === "oauth_expiry")?.expireAfterSeconds, 0);
});

test("setup is idempotent and an unchanged rerun leaves the schema intact", async () => {
  const db = await migratedDb();
  const before = await db.collection("projects").indexes();
  assert.deepEqual(await runMigrations(db), [
    { name: "0001-initial-collections", outcome: "already_applied" },
    { name: "0002-auth-indexes", outcome: "already_applied" },
  ]);
  assert.deepEqual(await db.collection("projects").indexes(), before);
  assert.equal((await db.collection("schemaMigrations").countDocuments()), 2);
  assert.equal((await verifySchema(db)).ok, true);
});

test("concurrent operators apply the migration exactly once", async () => {
  const db = freshDb();
  const results = await Promise.allSettled([runMigrations(db), runMigrations(db), runMigrations(db)]);
  const applied = results.filter((r) => r.status === "fulfilled" && r.value.every((m) => m.outcome === "applied"));
  assert.equal(applied.length, 1);
  for (const result of results) {
    if (result.status === "rejected") assert.ok(result.reason instanceof MigrationInProgressError, String(result.reason));
  }
  assert.equal(await db.collection("schemaMigrations").countDocuments(), 2);
  assert.equal((await verifySchema(db)).ok, true);
});

test("a changed checksum for an applied migration is refused", async () => {
  const db = await migratedDb();
  const altered = [{ ...MIGRATIONS[0], checksum: hash("altered") }];
  await assert.rejects(runMigrations(db, { migrations: altered }), MigrationChecksumError);
});

test("a conflicting existing index fails the migration explicitly and is recorded", async () => {
  const db = freshDb();
  await db.collection("projects").createIndex({ title: 1 }, { name: "project_list" });
  await assert.rejects(runMigrations(db), SchemaConflictError);
  const record = await db.collection("schemaMigrations").findOne({ migrationName: "0001-initial-collections" });
  assert.equal(record?.state, "failed");
  assert.equal(record?.errorCode, "SCHEMA_CONFLICT");
  assert.equal((await verifySchema(db)).ok, false);

  // After the operator resolves the conflict, the failed run can be taken over and completed.
  await db.collection("projects").dropIndex("project_list");
  assert.deepEqual((await runMigrations(db)).map((m) => m.outcome), ["applied", "applied"]);
  assert.equal((await verifySchema(db)).ok, true);
});

test("validators accept a valid record and reject missing, unknown and mistyped fields", async () => {
  const db = await migratedDb();
  const projects = db.collection("projects");
  await projects.insertOne(project() as never);

  const { title: _omitted, ...missingTitle } = project();
  for (const invalid of [
    missingTitle,
    { ...project(), unexpected: true },
    { ...project(), _id: "not-an-app-id" },
    { ...project(), contentRevision: 1 }, // Long required, not Int32
    { ...project(), schemaVersion: 2 },
    { ...project(), title: "" },
    { ...project(), flags: { drafts: true } },
  ]) {
    await assert.rejects(projects.insertOne(invalid as never), isValidationError, JSON.stringify(Object.keys(invalid)));
  }
});

test("job validator enforces the active slot rule and the partial unique index allows one active job per project", async () => {
  const db = await migratedDb();
  const jobs = db.collection("jobs");
  const projectId = newId("prj");
  await jobs.insertOne(job(projectId) as never);
  await assert.rejects(jobs.insertOne(job(projectId) as never), isDuplicateKey);

  const { activeSlot: _slot, ...withoutSlot } = job(projectId);
  await assert.rejects(jobs.insertOne(withoutSlot as never), isValidationError); // queued without slot
  await assert.rejects(jobs.insertOne(job(projectId, { state: "failed" }) as never), isValidationError); // terminal with slot
  await jobs.insertOne({ ...withoutSlot, _id: newId("job"), state: "succeeded" } as never); // terminal without slot
  await jobs.insertOne({ ...withoutSlot, _id: newId("job"), type: "cleanup", state: "running" } as never); // cleanup is exempt
  await jobs.insertOne(job(newId("prj")) as never); // other project unaffected
});

test("instagram account reservation allows many disconnected records but only one per account", async () => {
  const db = await migratedDb();
  const connections = db.collection("instagramConnections");
  const connection = (ownerId: string, instagramUserId?: string) => ({
    _id: newId("igc"),
    ...stamps(),
    ownerId,
    revision: 1,
    state: instagramUserId ? "connected" : "disconnected",
    scopes: [],
    tokenRevision: 1,
    destinationEpoch: 1,
    reconciliationOnly: false,
    ...(instagramUserId ? { instagramUserId } : {}),
  });
  await connections.insertOne(connection("user-a") as never);
  await connections.insertOne(connection("user-b") as never);
  await connections.insertOne(connection("user-c", "17841400000000000") as never);
  await assert.rejects(connections.insertOne(connection("user-d", "17841400000000000") as never), isDuplicateKey);
  await assert.rejects(connections.insertOne(connection("user-a") as never), isDuplicateKey); // one connection per owner
});

test("publish intent invariants are enforced within the document", async () => {
  const db = await migratedDb();
  const intents = db.collection("publishIntents");
  const due = new Date(Date.now() + 3_600_000);
  const intent = (overrides: Record<string, unknown> = {}) => ({
    _id: newId("pub"),
    ...stamps(),
    ownerId: "user-a",
    projectId: newId("prj"),
    revision: 1,
    payloadId: newId("pay"),
    payloadRevision: 1,
    videoId: "vid_example000000001",
    instagramUserId: "17841400000000000",
    contentKey: hash("content"),
    state: "scheduled",
    unresolved: true,
    dueAt: due,
    retryDeadlineAt: new Date(due.getTime() + 15 * 60_000),
    submissionBarrier: false,
    ...overrides,
  });
  await intents.insertOne(intent() as never);
  await assert.rejects(intents.insertOne(intent() as never), isDuplicateKey); // same unresolved content
  await assert.rejects(intents.insertOne(intent({ contentKey: hash("x"), retryDeadlineAt: new Date(0) }) as never), isValidationError);
  await assert.rejects(intents.insertOne(intent({ contentKey: hash("y"), unresolved: false }) as never), isValidationError);
  await assert.rejects(intents.insertOne(intent({ contentKey: hash("z"), state: "published", unresolved: false }) as never), isValidationError);
  await intents.insertOne(
    intent({ state: "published", unresolved: false, publishedAt: new Date(), providerMediaId: "1790000000" }) as never,
  ); // resolved intents do not reserve content
});

test("transactions commit atomically and roll back on abort", async () => {
  const db = await migratedDb();
  const session = client.startSession();
  const first = project("user-tx");
  try {
    await session.withTransaction(async () => {
      await db.collection("projects").insertOne(first as never, { session });
      await db.collection("conversations").insertOne(
        { _id: first.conversationId, ...stamps(), ownerId: "user-tx", projectId: first._id, kind: "project", nextSequence: Long.fromNumber(1) } as never,
        { session },
      );
    });
    const second = project("user-tx");
    await assert.rejects(
      session.withTransaction(async () => {
        await db.collection("projects").insertOne(second as never, { session });
        await db.collection("conversations").insertOne({ _id: second.conversationId, invalid: true } as never, { session });
      }),
      isValidationError,
    );
    assert.equal(await db.collection("projects").countDocuments({ ownerId: "user-tx" }), 1);
    assert.equal(await db.collection("conversations").countDocuments({ ownerId: "user-tx" }), 1);
  } finally {
    await session.endSession();
  }
});
