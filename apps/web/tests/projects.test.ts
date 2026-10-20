// F05 contract tests: the real route handlers with two signed-in users on a MongoDB replica set.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { MongoClient, type Db } from "mongodb";
import { createAuth, type AuthServices } from "../server/auth/auth";
import { provisionUser } from "../server/auth/provisioning";
import { DEFAULT_LOGIN_LIMITS } from "../server/auth/rate-limit";
import { signIn } from "../server/auth/session";
import { newId, runMigrations } from "../server/db/migrations";
import { handle } from "../server/http";

const ORIGIN = "http://127.0.0.1:3000";
const PASSWORD = "correct horse battery";

let replSet: MongoMemoryReplSet;
let client: MongoClient;
let db: Db;
let routes: {
  projects: typeof import("../app/api/projects/route");
  project: typeof import("../app/api/projects/[id]/route");
  job: typeof import("../app/api/jobs/[id]/route");
};
const users: Record<"a" | "b", { cookie: string; id: string }> = {} as never;

before(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  client = await new MongoClient(replSet.getUri()).connect();
  db = client.db(`f05_test_${process.pid}`);
  await runMigrations(db);
  const config = { secret: "test-secret-".padEnd(48, "x"), origin: ORIGIN };
  const services: AuthServices = { db, client, config, auth: createAuth({ db, client, config }), limits: DEFAULT_LOGIN_LIMITS };
  // Route handlers resolve services through getAuthServices(); point its cache at the test services.
  (globalThis as { __namasteAuth?: Promise<AuthServices> }).__namasteAuth = Promise.resolve(services);
  routes = {
    projects: await import("../app/api/projects/route"),
    project: await import("../app/api/projects/[id]/route"),
    job: await import("../app/api/jobs/[id]/route"),
  };
  for (const name of ["a", "b"] as const) {
    const { userId } = await provisionUser(services, { email: `${name}@example.com`, password: PASSWORD, operatorRef: "test" });
    const response = await handle((id) =>
      signIn(new Request(`${ORIGIN}/api/session/sign-in`, {
        method: "POST",
        headers: { origin: ORIGIN, "content-type": "application/json", "x-forwarded-for": `198.51.100.${name === "a" ? 1 : 2}` },
        body: JSON.stringify({ email: `${name}@example.com`, password: PASSWORD }),
      }), services, id),
    );
    users[name] = { id: userId, cookie: response.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ") };
  }
});
after(async () => {
  await client?.close();
  await replSet?.stop();
});

type Call = { user?: "a" | "b"; body?: unknown; key?: string | null; origin?: string | null; query?: string };
function req(method: string, path: string, { user = "a", body, key, origin, query = "" }: Call = {}) {
  const headers = new Headers();
  if (user) headers.set("cookie", users[user].cookie);
  if (origin !== null && method !== "GET") headers.set("origin", origin ?? ORIGIN);
  if (body !== undefined) headers.set("content-type", "application/json");
  if (key !== null && key !== undefined) headers.set("idempotency-key", key);
  return new Request(`${ORIGIN}${path}${query}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const json = async (response: Response) => ({ status: response.status, body: await response.json(), headers: response.headers });

const create = (call: Call = {}) =>
  routes.projects.POST(req("POST", "/api/projects", { body: {}, key: randomUUID(), ...call })).then(json);
const list = (query = "", user: "a" | "b" = "a") => routes.projects.GET(req("GET", "/api/projects", { user, query })).then(json);
const get = (id: string, user: "a" | "b" = "a") => routes.project.GET(req("GET", `/api/projects/${id}`, { user }), params(id)).then(json);
const patch = (id: string, body: unknown, user: "a" | "b" = "a") => routes.project.PATCH(req("PATCH", `/api/projects/${id}`, { user, body }), params(id)).then(json);
const remove = (id: string, body: unknown, call: Call = {}) =>
  routes.project.DELETE(req("DELETE", `/api/projects/${id}`, { body, key: randomUUID(), ...call }), params(id)).then(json);
const getJob = (id: string, user: "a" | "b" = "a") => routes.job.GET(req("GET", `/api/jobs/${id}`, { user }), params(id)).then(json);

test("every route requires a session, and mutations require the app Origin", async () => {
  const anonymous = new Request(`${ORIGIN}/api/projects`, { method: "GET" });
  assert.equal((await routes.projects.GET(anonymous)).status, 401);
  assert.equal((await routes.project.GET(new Request(`${ORIGIN}/api/projects/prj_x`), params("prj_x"))).status, 401);
  assert.equal((await routes.job.GET(new Request(`${ORIGIN}/api/jobs/job_x`), params("job_x"))).status, 401);
  assert.equal((await create({ origin: null })).body.error.code, "ORIGIN_NOT_ALLOWED");
  assert.equal((await create({ origin: "https://evil.example" })).status, 403);
});

test("creating a project returns 201 with defaults and commits its draft and conversation together", async () => {
  const response = await create({ body: { title: "  Binary search  " } });
  assert.equal(response.status, 201);
  const project = response.body.data;
  assert.equal(response.headers.get("location"), `/api/projects/${project.id}`);
  assert.match(project.id, /^prj_/);
  assert.deepEqual(
    { title: project.title, revision: project.revision, draftRevision: project.draftRevision, flags: project.flags, activeJobId: project.activeJobId },
    { title: "Binary search", revision: 1, draftRevision: 1, flags: { drafts: true, ready: false, scheduled: false, published: false, needsAttention: false }, activeJobId: null },
  );
  const draft = await db.collection("drafts").findOne({ projectId: project.id });
  assert.deepEqual([draft?.ownerId, draft?.revision, draft?.voicePreset, draft?.topic], [users.a.id, 1, "daniel-test", ""]);
  assert.match(String(draft?.contentHash), /^[a-f0-9]{64}$/);
  const conversation = await db.collection("conversations").findOne({ _id: project.conversationId });
  assert.equal(conversation?.projectId, project.id);

  assert.equal((await create()).body.data.title, "Untitled video");
});

test("a new project snapshots the owner's default voice preference", async () => {
  await db.collection("preferences").insertOne({
    _id: newId("prf"), schemaVersion: 1, ownerId: users.b.id, revision: 1, timezone: "Asia/Kolkata", defaultVoicePreset: "indian-english-female",
    createdAt: new Date(), updatedAt: new Date(),
  } as never);
  process.env.ELEVENLABS_VOICE_ID_INDIAN_FEMALE = "voice-test-female"; // the preset must be configured (F17 fallback)
  try {
    const { body } = await create({ user: "b" });
    assert.equal((await db.collection("drafts").findOne({ projectId: body.data.id }))?.voicePreset, "indian-english-female");
  } finally {
    delete process.env.ELEVENLABS_VOICE_ID_INDIAN_FEMALE;
  }
});

test("titles are trimmed, counted in code points and validated; unknown fields are rejected", async () => {
  assert.equal((await create({ body: { title: "   " } })).body.error.code, "VALIDATION_FAILED");
  assert.equal((await create({ body: { title: "x".repeat(101) } })).status, 422);
  assert.equal((await create({ body: { title: "🎬".repeat(100) } })).status, 201); // 100 code points, 200 UTF-16 units
  assert.equal((await create({ body: { title: "ok", ownerId: users.b.id } })).status, 422);
});

test("create is idempotent by key: replay, reuse with a different body, missing key and concurrency", async () => {
  const key = randomUUID();
  const first = await create({ key, body: { title: "Idempotent" } });
  const replay = await create({ key, body: { title: "Idempotent" } });
  assert.equal(replay.status, 201);
  assert.equal(replay.headers.get("idempotency-replayed"), "true");
  assert.equal(replay.body.data.id, first.body.data.id);
  assert.equal((await create({ key, body: { title: "Different" } })).body.error.code, "IDEMPOTENCY_KEY_REUSED");
  assert.equal((await create({ key: null })).status, 422);
  assert.equal((await create({ key: "short" })).status, 422);

  const unusedKey = randomUUID();
  assert.equal((await create({ key: unusedKey, body: { title: "" } })).status, 422); // validation failure does not consume the key
  assert.equal((await create({ key: unusedKey, body: { title: "Now valid" } })).status, 201);

  const raceKey = randomUUID();
  const results = await Promise.all(Array.from({ length: 5 }, () => create({ key: raceKey, body: { title: "Race" } })));
  assert.ok(results.every((r) => r.status === 201));
  assert.equal(new Set(results.map((r) => r.body.data.id)).size, 1);
  assert.equal(await db.collection("projects").countDocuments({ ownerId: users.a.id, title: "Race" }), 1);
});

test("another user's, malformed and unknown project IDs are all 404", async () => {
  const { body } = await create({ body: { title: "Private to A" } });
  const id = body.data.id;
  assert.equal((await get(id, "b")).body.error.code, "NOT_FOUND");
  assert.equal((await patch(id, { expectedRevision: 1, title: "Hijack" }, "b")).status, 404);
  assert.equal((await remove(id, { expectedRevision: 1, confirm: true }, { user: "b" })).status, 404);
  assert.equal((await get("not-an-id")).status, 404);
  assert.equal((await get("prj_doesnotexist000000")).status, 404);
  assert.ok(!(await list("?limit=50", "b")).body.data.some((p: { id: string }) => p.id === id));
  assert.equal((await get(id)).body.data.title, "Private to A");
});

test("listing pages by updatedAt/id with signed cursors, filters and strict query validation", async () => {
  const owner = "b";
  for (let i = 0; i < 4; i++) await create({ user: owner, body: { title: `Page ${i}` } });
  const all = (await list("?limit=50", owner)).body.data as { id: string; updatedAt: string }[];
  const seen: string[] = [];
  let cursor: string | null = null;
  do {
    const page: Awaited<ReturnType<typeof list>> = await list(`?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, owner);
    assert.equal(page.status, 200);
    assert.ok(page.body.data.length <= 2);
    seen.push(...page.body.data.map((p: { id: string }) => p.id));
    cursor = page.body.page.nextCursor;
    assert.equal(page.body.page.hasMore, cursor !== null);
  } while (cursor);
  assert.deepEqual(seen, all.map((p) => p.id));
  const sorted = [...all].sort((x, y) => y.updatedAt.localeCompare(x.updatedAt) || y.id.localeCompare(x.id));
  assert.deepEqual(all.map((p) => p.id), sorted.map((p) => p.id));

  assert.equal((await list("?filter=drafts&limit=50", owner)).body.data.length, all.length);
  assert.deepEqual((await list("?filter=ready", owner)).body.data, []);

  const valid = (await list("?limit=1", owner)).body.page.nextCursor as string;
  const tampered = valid.slice(0, -2) + (valid.endsWith("A") ? "BB" : "AA");
  assert.equal((await list(`?cursor=${encodeURIComponent(tampered)}`, owner)).body.error.code, "INVALID_CURSOR");
  assert.equal((await list(`?cursor=${encodeURIComponent(valid)}`, "a")).body.error.code, "INVALID_CURSOR"); // other owner
  assert.equal((await list(`?filter=drafts&cursor=${encodeURIComponent(valid)}`, owner)).body.error.code, "INVALID_CURSOR");
  for (const bad of ["?limit=0", "?limit=51", "?filter=everything", "?offset=3"]) {
    assert.equal((await list(bad, owner)).body.error.code, "INVALID_QUERY", bad);
  }
});

test("rename uses revision CAS: stale writes conflict with the current revision", async () => {
  const { body } = await create({ body: { title: "Original" } });
  const id = body.data.id;
  const renamed = await patch(id, { expectedRevision: 1, title: "Renamed" });
  assert.deepEqual([renamed.status, renamed.body.data.title, renamed.body.data.revision], [200, "Renamed", 2]);
  const stale = await patch(id, { expectedRevision: 1, title: "Stale" });
  assert.equal(stale.status, 409);
  assert.deepEqual(stale.body.error.details, { currentRevision: 2, reloadUrl: `/api/projects/${id}` });
  assert.equal((await patch(id, { title: "No precondition" })).status, 422);
  assert.equal((await patch(id, { expectedRevision: 2 })).status, 422);
  assert.equal((await patch(id, { expectedRevision: 2, selectedVideoId: "vid_doesnotexist000000" })).body.error.code, "VIDEO_NOT_READY");

  const race = await Promise.all([patch(id, { expectedRevision: 2, title: "Tab one" }), patch(id, { expectedRevision: 2, title: "Tab two" })]);
  assert.deepEqual(race.map((r) => r.status).sort(), [200, 409]);
});

test("delete tombstones the project, cancels queued work and unsubmitted delivery, and queues cleanup", async () => {
  const { body } = await create({ body: { title: "To delete" } });
  const id = body.data.id;
  const now = new Date();
  const queuedJob = newId("job");
  await db.collection("jobs").insertOne({
    _id: queuedJob, schemaVersion: 1, ownerId: users.a.id, projectId: id, type: "storyboard", state: "queued", revision: 1, stage: "queued",
    inputSnapshot: {}, inputHash: "a".repeat(64), executionAttempt: 1, progress: {}, deadlineAt: now, activeSlot: true, createdAt: now, updatedAt: now,
  } as never);
  const due = new Date(Date.now() + 3_600_000);
  const intentId = newId("pub");
  await db.collection("publishIntents").insertOne({
    _id: intentId, schemaVersion: 1, ownerId: users.a.id, projectId: id, revision: 1, payloadId: newId("pay"), payloadRevision: 1, videoId: newId("vid"),
    instagramUserId: "17841400000000001", contentKey: "c".repeat(64), state: "scheduled", unresolved: true, dueAt: due,
    retryDeadlineAt: new Date(due.getTime() + 900_000), submissionBarrier: false, createdAt: now, updatedAt: now,
  } as never);

  assert.equal((await remove(id, { expectedRevision: 9, confirm: true })).status, 409);
  assert.equal((await remove(id, { expectedRevision: 1 })).status, 422);
  const key = randomUUID();
  const accepted = await remove(id, { expectedRevision: 1, confirm: true }, { key });
  assert.equal(accepted.status, 202);
  const operation = accepted.body.data;
  assert.deepEqual({ ...operation, jobId: undefined }, { jobId: undefined, resource: { kind: "project", id }, state: "queued", statusUrl: `/api/jobs/${operation.jobId}` });
  assert.equal(accepted.headers.get("location"), operation.statusUrl);

  assert.equal((await get(id)).status, 404);
  assert.ok(!(await list("?limit=50")).body.data.some((p: { id: string }) => p.id === id));
  assert.equal((await patch(id, { expectedRevision: 2, title: "Too late" })).status, 404);

  const job = await getJob(operation.jobId);
  assert.deepEqual([job.status, job.body.data.type, job.body.data.state, job.body.data.result, job.body.data.actions.cancel], [200, "cleanup", "queued", null, false]);
  assert.equal((await getJob(operation.jobId, "b")).status, 404);
  assert.equal((await getJob(queuedJob)).status, 404); // other jobs of a deleted project are hidden
  assert.equal((await db.collection("jobs").findOne({ _id: queuedJob as never }))?.state, "cancelled");
  assert.equal((await db.collection("publishIntents").findOne({ _id: intentId as never }))?.state, "cancelled");
  assert.equal(await db.collection("outbox").countDocuments({ aggregateId: id, eventType: "project.cleanup_requested", state: "pending" }), 1);

  const replay = await remove(id, { expectedRevision: 1, confirm: true }, { key });
  assert.deepEqual([replay.status, replay.body.data.jobId, replay.headers.get("idempotency-replayed")], [202, operation.jobId, "true"]);
  assert.equal((await remove(id, { expectedRevision: 2, confirm: true })).status, 404); // new key after deletion
});
