// F12: private asset storage, owner-authorized short-lived grants, gateway ranges/expiry/revocation/deletion and
// missing-object behavior. Uses the in-memory object store with R2 semantics (ETag = MD5).
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createAccessGrant, parseRange, revokeProjectGrants, storeAsset } from "../server/media/assets";
import { MemoryObjectStore, setObjectStoreForTests, type ObjectStore } from "../server/media/object-store";
import { json, params, startHarness, ORIGIN, type Harness } from "./harness";

let h: Harness;
const store = new MemoryObjectStore();
let routes: { projects: typeof import("../app/api/projects/route"); project: typeof import("../app/api/projects/[id]/route"); access: typeof import("../app/api/assets/[id]/access/route"); media: typeof import("../app/api/media/[token]/route") };
const VIDEO = Buffer.from(Array.from({ length: 5000 }, (_, i) => i % 251));

before(async () => {
  setObjectStoreForTests(store);
  h = await startHarness("f12", ["a", "b"]);
  routes = {
    projects: await import("../app/api/projects/route"),
    project: await import("../app/api/projects/[id]/route"),
    access: await import("../app/api/assets/[id]/access/route"),
    media: await import("../app/api/media/[token]/route"),
  };
});
after(async () => {
  setObjectStoreForTests(undefined);
  await h?.stop();
});

const newProject = async (user = "a") => (await json(await routes.projects.POST(h.request("POST", "/api/projects", { user, body: {}, key: randomUUID() })))).body.data.id as string;
const put = (projectId: string, s: ObjectStore = store, user = "a") =>
  storeAsset(h.services, s, { ownerId: h.users[user].id, projectId, originJobId: "job_test0000000000000001", kind: "video", contentType: "video/mp4", body: VIDEO, producerFingerprint: "f".repeat(64), metadata: { durationSeconds: 72, width: 1080, height: 1920, fps: 30, codec: "h264" } });
const access = async (assetId: string, purpose = "preview", user = "a") =>
  json(await routes.access.POST(h.request("POST", `/api/assets/${assetId}/access`, { user, body: { purpose } }), params(assetId)));
const media = (url: string, headers: Record<string, string> = {}, method = "GET") => {
  const token = url.split("/").pop()!;
  const request = new Request(`${ORIGIN}${url}`, { method, headers });
  return method === "HEAD" ? routes.media.HEAD(request, { params: Promise.resolve({ token }) }) : routes.media.GET(request, { params: Promise.resolve({ token }) });
};

test("storing an asset uploads to a server-generated key and commits a verified ready record", async () => {
  const projectId = await newProject();
  const asset = await put(projectId);
  assert.match(asset.objectKey, new RegExp(`^projects/${projectId}/video/ast_[A-Za-z0-9_-]+\\.mp4$`));
  assert.deepEqual(store.objects.get(asset.objectKey)?.body, VIDEO);
  const record = await h.db.collection("assets").findOne({ _id: asset.assetId as never });
  assert.deepEqual([record?.state, record?.sha256, Number(record?.bytes), record?.metadata.width], ["ready", asset.sha256, VIDEO.length, 1080]);
});

test("a failed integrity check or a project deleted during upload never yields a ready asset", async () => {
  const projectId = await newProject();
  const corrupting: ObjectStore = { ...store, put: (key, body, type) => store.put(key, body.subarray(0, 10), type), head: (k) => store.head(k), get: (k, r) => store.get(k, r), delete: (k) => store.delete(k) };
  await assert.rejects(put(projectId, corrupting), /integrity/);
  assert.equal(await h.db.collection("assets").countDocuments({ projectId, state: "ready" }), 0);

  const deleting: ObjectStore = {
    put: async (key, body, type) => {
      await routes.project.DELETE(h.request("DELETE", `/api/projects/${projectId}`, { body: { expectedRevision: 1, confirm: true }, key: randomUUID() }), params(projectId));
      await store.put(key, body, type);
    },
    head: (k) => store.head(k),
    get: (k, r) => store.get(k, r),
    delete: (k) => store.delete(k),
  };
  await assert.rejects(put(projectId, deleting), (e: { code?: string }) => e.code === "NOT_FOUND");
  assert.equal(await h.db.collection("assets").countDocuments({ projectId, state: "ready" }), 0);
  assert.ok(![...store.objects.keys()].some((k) => k.startsWith(`projects/${projectId}/`)), "orphaned upload removed");
});

test("access URLs are owner-only, short-lived and store only a token hash", async () => {
  const projectId = await newProject();
  const asset = await put(projectId);
  const grant = await access(asset.assetId);
  assert.equal(grant.status, 200);
  assert.match(grant.body.data.url, /^\/api\/media\/[A-Za-z0-9_-]{43}$/);
  const ttl = Date.parse(grant.body.data.expiresAt) - Date.now();
  assert.ok(ttl > 9 * 60_000 && ttl <= 10 * 60_000);
  assert.deepEqual([grant.body.data.contentType, grant.body.data.bytes], ["video/mp4", VIDEO.length]);
  const token = grant.body.data.url.split("/").pop();
  assert.ok(!JSON.stringify(await h.db.collection("mediaGrants").find().toArray()).includes(token));

  assert.equal((await access(asset.assetId, "preview", "b")).status, 404);
  assert.equal((await access("ast_doesnotexist000000")).status, 404);
  assert.equal((await access(asset.assetId, "everything")).status, 422);
  assert.equal((await json(await routes.access.POST(new Request(`${ORIGIN}/api/assets/${asset.assetId}/access`, { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json" }, body: "{\"purpose\":\"preview\"}" }), params(asset.assetId)))).status, 401);
});

test("the gateway streams full and ranged bytes with safe headers, and download grants set a filename", async () => {
  const projectId = await newProject();
  const asset = await put(projectId);
  const { url } = (await access(asset.assetId)).body.data;

  const full = await media(url);
  assert.equal(full.status, 200);
  assert.deepEqual(Buffer.from(await full.arrayBuffer()), VIDEO);
  for (const [name, value] of [["content-type", "video/mp4"], ["accept-ranges", "bytes"], ["cache-control", "private, no-store"], ["x-content-type-options", "nosniff"], ["content-length", String(VIDEO.length)]]) {
    assert.equal(full.headers.get(name), value, name);
  }
  const partial = await media(url, { range: "bytes=100-199" });
  assert.deepEqual([partial.status, partial.headers.get("content-range"), partial.headers.get("content-length")], [206, `bytes 100-199/${VIDEO.length}`, "100"]);
  assert.deepEqual(Buffer.from(await partial.arrayBuffer()), VIDEO.subarray(100, 200));
  const suffix = await media(url, { range: "bytes=-50" });
  assert.deepEqual(Buffer.from(await suffix.arrayBuffer()), VIDEO.subarray(VIDEO.length - 50));
  const unsatisfiable = await media(url, { range: "bytes=9999-" });
  assert.deepEqual([unsatisfiable.status, unsatisfiable.headers.get("content-range")], [416, `bytes */${VIDEO.length}`]);
  const head = await media(url, {}, "HEAD");
  assert.deepEqual([head.status, head.headers.get("content-length"), await head.text()], [200, String(VIDEO.length), ""]);

  const download = await media((await access(asset.assetId, "download")).body.data.url);
  assert.match(download.headers.get("content-disposition") ?? "", /^attachment; filename="namastevideo-video-[^"]+\.mp4"$/);
});

test("expired, revoked, malformed and deleted-project grants are denied; a missing object is reported, not linked", async () => {
  const projectId = await newProject();
  const asset = await put(projectId);
  const url = (await access(asset.assetId)).body.data.url as string;
  assert.equal((await media("/api/media/not-a-token")).status, 404);

  await h.db.collection("mediaGrants").updateMany({ assetId: asset.assetId }, { $set: { createdAt: new Date(Date.now() - 20 * 60_000), expiresAt: new Date(Date.now() - 1000) } });
  assert.equal((await media(url)).status, 404, "expired grants are denied even before TTL cleanup");

  const fresh = (await access(asset.assetId)).body.data.url as string;
  await revokeProjectGrants(h.db, h.users.a.id, projectId);
  assert.equal((await media(fresh)).status, 404);

  const another = (await access(asset.assetId)).body.data.url as string;
  store.objects.delete(asset.objectKey);
  assert.equal((await media(another)).status, 404);
  const missing = await access(asset.assetId);
  assert.deepEqual([missing.status, missing.body.error.code, missing.body.error.details], [422, "ASSET_NOT_READY", { reason: "missing" }]);

  const second = await newProject();
  const kept = await put(second);
  const link = (await access(kept.assetId)).body.data.url as string;
  await routes.project.DELETE(h.request("DELETE", `/api/projects/${second}`, { body: { expectedRevision: 1, confirm: true }, key: randomUUID() }), params(second));
  assert.equal((await media(link)).status, 404, "tombstoned projects stop media immediately");
  assert.equal((await access(kept.assetId)).status, 404);
});

test("byte ranges are parsed strictly", () => {
  assert.deepEqual(parseRange("bytes=0-9", 100), { start: 0, end: 9 });
  assert.deepEqual(parseRange("bytes=90-", 100), { start: 90, end: 99 });
  assert.deepEqual(parseRange("bytes=-10", 100), { start: 90, end: 99 });
  assert.deepEqual(parseRange("bytes=50-500", 100), { start: 50, end: 99 });
  assert.equal(parseRange("bytes=100-", 100), "unsatisfiable");
  assert.equal(parseRange("bytes=-0", 100), "unsatisfiable");
  assert.equal(parseRange("bytes=0-1,5-6", 100), null);
  assert.equal(parseRange(null, 100), null);
});
