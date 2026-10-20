// F19: reviewed Post now — frozen payload, destination checks, delivery with a fake Instagram publisher, the
// submission barrier, outcome-unknown reconciliation, cancel/retry and duplicate protection.
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import realPlan from "./fixtures/plan-dns.json";
import { commandIdentity } from "../server/commands";
import { acceptGeneration } from "../server/generation/service";
import { runGeneration } from "../server/generation/runner";
import type { Prober, Renderer } from "../server/generation/render-local";
import { readInstagramConfig } from "../server/instagram/config";
import { encryptToken } from "../server/instagram/crypto";
import { InstagramProviderError, setInstagramPublisherForTests, type ContainerStatus, type InstagramPublisher } from "../server/instagram/provider";
import { resolveGrant } from "../server/media/assets";
import { MemoryObjectStore, setObjectStoreForTests } from "../server/media/object-store";
import { advanceDueIntents, advancePublish } from "../server/publish/delivery";
import type { SpeechProvider } from "../server/speech/elevenlabs";
import { acceptStoryboard, runStoryboard, storyboardContentHash } from "../server/storyboards/service";
import type { PlanV2 } from "../lib/plan";
import { json, params, startHarness, type Harness } from "./harness";

const ENV: Record<string, string> = {
  INSTAGRAM_APP_ID: "123456789012345",
  INSTAGRAM_APP_SECRET: "test-app-secret",
  INSTAGRAM_REDIRECT_URI: "https://localhost:3000/api/instagram/callback",
  INSTAGRAM_TOKEN_KEY: "cd".repeat(32),
  MEDIA_PUBLIC_ORIGIN: "https://media.example.test",
};
let h: Harness;
const store = new MemoryObjectStore();
let routes: {
  projects: typeof import("../app/api/projects/route");
  draft: typeof import("../app/api/projects/[id]/draft/route");
  apply: typeof import("../app/api/projects/[id]/draft/apply/route");
  approve: typeof import("../app/api/videos/[id]/approve/route");
  publish: typeof import("../app/api/publish-intents/route");
  one: typeof import("../app/api/publish-intents/[id]/route");
  cancel: typeof import("../app/api/publish-intents/[id]/cancel/route");
  retry: typeof import("../app/api/publish-intents/[id]/retry/route");
  list: typeof import("../app/api/projects/[id]/publish-intents/route");
};

// ── Fake Instagram publisher ──
const ig = {
  containers: [] as { videoUrl: string; caption: string; id: string }[],
  publishCalls: 0,
  status: "FINISHED" as ContainerStatus,
  statusQueue: [] as ContainerStatus[],
  createError: null as InstagramProviderError | null,
  publishError: null as InstagramProviderError | null,
};
const fakePublisher: InstagramPublisher = {
  async createReelContainer({ videoUrl, caption, accessToken }) {
    assert.equal(accessToken, "fake-long-lived-token", "worker decrypts the stored token");
    if (ig.createError) throw ig.createError;
    const id = `container-${ig.containers.length + 1}`;
    ig.containers.push({ videoUrl, caption, id });
    return id;
  },
  async containerStatus() {
    return ig.statusQueue.shift() ?? ig.status;
  },
  async publishContainer() {
    ig.publishCalls++;
    if (ig.publishError) throw ig.publishError;
    return `media-${ig.publishCalls}`;
  },
  async permalink({ mediaId }) {
    return `https://www.instagram.com/reel/${mediaId}/`;
  },
};

const plan = realPlan as PlanV2;
const direct = <T>(_id: string, run: () => Promise<T>) => run();
const speech: SpeechProvider = async (text) => {
  const characters = [...text];
  return { audio: Buffer.concat([Buffer.from("ID3"), Buffer.alloc(1500, 3)]), durationSeconds: characters.length * 0.07, alignment: { characters, character_start_times_seconds: characters.map((_, i) => i * 0.07), character_end_times_seconds: characters.map((_, i) => (i + 1) * 0.07) } };
};
const renderer: Renderer = async (timeline) => ({ video: Buffer.from(`mp4-${timeline.frames}-${randomUUID()}`), durationMs: 5, peakRssBytes: null });
const prober: Prober = async (video) => ({ format: { duration: String(Number(String(video).split("-")[1]) / 30) }, streams: [{ codec_type: "video", codec_name: "h264", width: 1080, height: 1920, avg_frame_rate: "30/1" }, { codec_type: "audio", codec_name: "aac" }] });

const saved: Record<string, string | undefined> = {};
before(async () => {
  for (const [k, v] of Object.entries(ENV)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  setObjectStoreForTests(store);
  setInstagramPublisherForTests(fakePublisher);
  h = await startHarness("f19", ["a", "b"]);
  routes = {
    projects: await import("../app/api/projects/route"),
    draft: await import("../app/api/projects/[id]/draft/route"),
    apply: await import("../app/api/projects/[id]/draft/apply/route"),
    approve: await import("../app/api/videos/[id]/approve/route"),
    publish: await import("../app/api/publish-intents/route"),
    one: await import("../app/api/publish-intents/[id]/route"),
    cancel: await import("../app/api/publish-intents/[id]/cancel/route"),
    retry: await import("../app/api/publish-intents/[id]/retry/route"),
    list: await import("../app/api/projects/[id]/publish-intents/route"),
  };
});
after(async () => {
  setObjectStoreForTests(undefined);
  setInstagramPublisherForTests(undefined);
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await h?.stop();
});
beforeEach(() => {
  Object.assign(ig, { containers: [], publishCalls: 0, status: "FINISHED", statusQueue: [], createError: null, publishError: null });
});

const identity = (path: string, body: unknown, user = "a") => commandIdentity(new Request("http://x", { method: "POST", headers: { "idempotency-key": randomUUID() } }), h.users[user].id, path, body);

async function approvedVideo(user = "a") {
  const project = (await json(await routes.projects.POST(h.request("POST", "/api/projects", { user, body: {}, key: randomUUID() })))).body.data;
  await routes.draft.PATCH(h.request("PATCH", `/api/projects/${project.id}/draft`, { user, body: { expectedRevision: 1, changes: { topic: "How DNS works" } } }), params(project.id));
  const sb = { expectedDraftRevision: 2 };
  const { jobId } = await acceptStoryboard(h.services, identity(`/api/projects/${project.id}/storyboards`, sb, user), project.id, sb);
  await runStoryboard(h.services, jobId, async () => ({ plan, warnings: [], attempts: 1 }), "test");
  const storyboard = await h.db.collection("storyboards").findOne({ projectId: project.id });
  const applied = (await json(await routes.apply.POST(h.request("POST", `/api/projects/${project.id}/draft/apply`, { user, key: randomUUID(), body: { expectedDraftRevision: 2, storyboardId: String(storyboard?._id), expectedContentHash: storyboardContentHash(plan) } }), params(project.id)))).body.data;
  const body = { expectedDraftRevision: applied.revision, expectedContentHash: applied.contentHash, approve: true as const };
  const { operation } = await acceptGeneration(h.services, identity(`/api/projects/${project.id}/generations`, body, user), project.id, body);
  await runGeneration(h.services, operation.jobId, { speech, store, renderer, prober }, direct);
  const videoId = operation.resource!.id;
  const video = await h.db.collection("videos").findOne({ _id: videoId as never });
  const approved = await json(await routes.approve.POST(h.request("POST", `/api/videos/${videoId}/approve`, { user, key: randomUUID(), body: { expectedOutputHash: video!.outputHash, expectedRenderSpecHash: video!.renderSpecHash, approve: true } }), params(videoId)));
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  const fresh = await h.db.collection("videos").findOne({ _id: videoId as never });
  return { projectId: project.id as string, videoId, approvalId: String(fresh!.finalApprovalId), outputHash: String(fresh!.outputHash) };
}

async function connect(user = "a", instagramUserId = "17841400000000123") {
  const ownerId = h.users[user].id;
  const id = `igc_test${user}connection000001`;
  const now = new Date();
  await h.db.collection("instagramConnections").deleteMany({ ownerId });
  await h.db.collection("instagramConnections").insertOne({
    _id: id as never, schemaVersion: 1, ownerId, revision: 1, state: "connected", instagramUserId, username: `creator_${user}`, accountType: "CREATOR",
    scopes: ["instagram_business_basic", "instagram_business_content_publish"], encryptedToken: encryptToken(readInstagramConfig()!, ownerId, id, "fake-long-lived-token"),
    expiresAt: new Date(now.getTime() + 50 * 864e5), tokenRevision: 1, destinationEpoch: 1, reconciliationOnly: false, createdAt: now, updatedAt: now,
  });
  return { connectionId: id, instagramUserId, destinationEpoch: 1 };
}

type Fixture = Awaited<ReturnType<typeof approvedVideo>> & { destination: Awaited<ReturnType<typeof connect>> };
const postBody = (f: Fixture, overrides: Record<string, unknown> = {}, payload: Record<string, unknown> = {}) => ({
  projectId: f.projectId,
  payload: { videoId: f.videoId, videoApprovalId: f.approvalId, expectedOutputHash: f.outputHash, destination: f.destination, caption: "How DNS works, in 80 seconds. #explained", ...payload },
  mode: "now",
  confirm: true,
  ...overrides,
});
const post = async (body: unknown, user = "a", key = randomUUID()) => json(await routes.publish.POST(h.request("POST", "/api/publish-intents", { user, body, key })));
const getIntent = async (id: string, user = "a") => json(await routes.one.GET(h.request("GET", `/api/publish-intents/${id}`, { user }), params(id)));
const later = (ms: number) => ({ now: () => new Date(Date.now() + ms) });
const run = (id: string, ms = 60_000) => advancePublish(h.db, id, later(ms));

async function fixture(user = "a"): Promise<Fixture> {
  const video = await approvedVideo(user);
  return { ...video, destination: await connect(user) };
}

test("Post now validates approval, destination, caption and availability before freezing anything", async () => {
  const f = await fixture();
  const count = () => h.db.collection("publishIntents").countDocuments({ ownerId: h.users.a.id });
  assert.equal((await post(postBody(f, { mode: "schedule" }))).body.error.code, "INVALID_SCHEDULE");
  assert.equal((await post(postBody(f, {}, { videoApprovalId: "apr_notthisapproval000000" }))).body.error.code, "VIDEO_NOT_APPROVED");
  assert.equal((await post(postBody(f, {}, { expectedOutputHash: "0".repeat(64) }))).body.error.code, "HASH_MISMATCH");
  assert.equal((await post(postBody(f, {}, { destination: { ...f.destination, destinationEpoch: 2 } }))).body.error.code, "DESTINATION_CHANGED");
  assert.equal((await post(postBody(f, {}, { caption: "x".repeat(2201) }))).status, 422);
  assert.equal((await post(postBody(f, {}, { caption: "bad\u0007bell" }))).status, 422);
  assert.equal((await post(postBody(f, { confirm: false }))).status, 422);
  assert.equal((await post(postBody(f), "b")).status, 404, "another user's project");
  delete process.env.MEDIA_PUBLIC_ORIGIN;
  try {
    assert.equal((await post(postBody(f))).body.error.code, "PUBLISHING_UNAVAILABLE");
  } finally {
    process.env.MEDIA_PUBLIC_ORIGIN = ENV.MEDIA_PUBLIC_ORIGIN;
  }
  await h.db.collection("instagramConnections").updateOne({ ownerId: h.users.a.id }, { $set: { state: "reconnect_required" } });
  assert.equal((await post(postBody(f))).body.error.code, "RECONNECT_REQUIRED");
  assert.equal(await count(), 0, "nothing frozen or queued");
});

test("a confirmed Post now freezes the payload once, deduplicates and delivers exactly one publication", async () => {
  const f = await fixture();
  const key = randomUUID();
  const created = await post(postBody(f), "a", key);
  assert.equal(created.status, 201);
  const intent = created.body.data;
  assert.deepEqual([intent.state, intent.destination.usernameAtApproval, intent.caption, intent.assetHash, intent.actions.cancel], ["queued", "creator_a", "How DNS works, in 80 seconds. #explained", f.outputHash, true]);
  assert.match(intent.payloadHash, /^[a-f0-9]{64}$/);
  assert.ok(await h.db.collection("outbox").findOne({ eventType: "publish.requested", "payloadIds.intentId": intent.id }));
  assert.equal((await post(postBody(f), "a", key)).headers.get("idempotency-replayed"), "true");
  const again = await post(postBody(f));
  assert.deepEqual([again.status, again.body.data.id, again.headers.get("x-deduplicated")], [200, intent.id, "true"], "same payload under a new key returns the same post");

  ig.statusQueue = ["IN_PROGRESS"];
  assert.equal(await run(intent.id), "processing");
  assert.equal(ig.containers.length, 1);
  const { videoUrl, caption } = ig.containers[0];
  assert.equal(caption, intent.caption);
  assert.match(videoUrl, /^https:\/\/media\.example\.test\/api\/media\/[A-Za-z0-9_-]{43}$/);
  const media = await resolveGrant(h.db, videoUrl.split("/").pop()!);
  assert.equal(media?.contentType, "video/mp4", "Instagram can fetch exactly the approved MP4");
  const grant = await h.db.collection("mediaGrants").findOne({ intentId: intent.id });
  assert.equal(grant?.purpose, "ingest");
  assert.equal(await run(intent.id, 120_000), "processing", "still processing");
  assert.equal(await run(intent.id, 180_000), "published");
  assert.equal(ig.publishCalls, 1);
  const done = (await getIntent(intent.id)).body.data;
  assert.deepEqual([done.state, done.providerMediaId, done.permalink, done.actions.cancel, done.actions.retry], ["published", "media-1", "https://www.instagram.com/reel/media-1/", false, false]);
  assert.ok(done.publishedAt);
  assert.equal(await resolveGrant(h.db, videoUrl.split("/").pop()!), null, "ingest grant revoked after publication");
  assert.equal(await run(intent.id, 240_000), "skipped", "published intents are never processed again");
  assert.equal(ig.publishCalls, 1);
  assert.ok(!JSON.stringify(done).includes("fake-long-lived-token") && !JSON.stringify(done).includes("/api/media/"));

  const repeat = await post(postBody(f));
  assert.deepEqual([repeat.status, repeat.body.error.code, repeat.body.error.details.intentId], [409, "ALREADY_PUBLISHED", intent.id]);
  const repost = await post(postBody(f, { repostOfIntentId: intent.id }));
  assert.equal(repost.status, 201, "an explicit repost is a new confirmed post");
  const list = await json(await routes.list.GET(h.request("GET", `/api/projects/${f.projectId}/publish-intents`), params(f.projectId)));
  assert.deepEqual(list.body.data.map((i: { id: string }) => i.id), [repost.body.data.id, intent.id]);
  assert.equal((await getIntent(intent.id, "b")).status, 404);
});

test("an uncertain publish response is reconciled from the container and never re-published automatically", async () => {
  const f = await fixture();
  const intent = (await post(postBody(f))).body.data;
  await run(intent.id);
  ig.publishError = new InstagramProviderError("PROVIDER_UNAVAILABLE", "timeout");
  assert.equal(await run(intent.id, 120_000), "outcome_unknown");
  let current = (await getIntent(intent.id)).body.data;
  assert.deepEqual([current.state, current.actions.cancel, current.actions.retry, current.error.code], ["outcome_unknown", false, false, "OUTCOME_UNKNOWN"]);
  assert.equal((await json(await routes.cancel.POST(h.request("POST", `/api/publish-intents/${intent.id}/cancel`, { key: randomUUID(), body: { expectedRevision: current.revision } }), params(intent.id)))).body.error.code, "OUTCOME_UNKNOWN");
  assert.equal((await json(await routes.retry.POST(h.request("POST", `/api/publish-intents/${intent.id}/retry`, { key: randomUUID(), body: { expectedRevision: current.revision, confirm: true } }), params(intent.id)))).body.error.code, "OUTCOME_UNKNOWN");
  assert.equal((await post(postBody(f))).body.data.id, intent.id, "no second post while the outcome is unknown");

  // Reconcile: still unknown → keep checking; then the container shows it was NOT published → safe retry offered.
  ig.publishError = null;
  ig.statusQueue = ["IN_PROGRESS"];
  assert.equal(await run(intent.id, 5 * 60_000), "outcome_unknown");
  ig.statusQueue = ["FINISHED"];
  assert.equal(await run(intent.id, 10 * 60_000), "failed_safe");
  assert.equal(ig.publishCalls, 1, "reconciliation never calls publish");
  current = (await getIntent(intent.id)).body.data;
  assert.deepEqual([current.state, current.actions.retry, current.error.code], ["failed_safe", true, "NOT_PUBLISHED"]);

  const retried = await json(await routes.retry.POST(h.request("POST", `/api/publish-intents/${intent.id}/retry`, { key: randomUUID(), body: { expectedRevision: current.revision, confirm: true } }), params(intent.id)));
  assert.equal(retried.body.data.state, "queued");
  await advancePublish(h.db, intent.id);
  assert.equal(await run(intent.id), "published");
  assert.deepEqual([ig.publishCalls, ig.containers.length], [2, 2], "the explicit retry used a new container");
  assert.equal(await h.db.collection("publishAttempts").countDocuments({ intentId: intent.id }), 2);
});

test("a container that Instagram reports as published after an uncertain response needs attention and blocks reposting", async () => {
  const f = await fixture();
  const intent = (await post(postBody(f))).body.data;
  await run(intent.id);
  ig.publishError = new InstagramProviderError("INVALID_RESPONSE", "garbled");
  assert.equal(await run(intent.id, 120_000), "outcome_unknown");
  ig.statusQueue = ["PUBLISHED"];
  assert.equal(await run(intent.id, 5 * 60_000), "needs_attention");
  const current = (await getIntent(intent.id)).body.data;
  assert.deepEqual([current.state, current.actions.retry, current.actions.cancel, current.error.code], ["needs_attention", false, false, "OUTCOME_LIKELY_PUBLISHED"]);
  assert.equal((await post(postBody(f))).body.data.id, intent.id, "still the unresolved post; no duplicate");
});

test("safe failures can be cancelled or retried; paused accounts and expired windows never post", async () => {
  const f = await fixture();
  // Instagram rejects the media while processing.
  const first = (await post(postBody(f))).body.data;
  await run(first.id);
  ig.statusQueue = ["ERROR"];
  assert.equal(await run(first.id, 120_000), "failed_safe");
  let current = (await getIntent(first.id)).body.data;
  assert.equal(current.error.code, "MEDIA_REJECTED");
  const cancelled = await json(await routes.cancel.POST(h.request("POST", `/api/publish-intents/${first.id}/cancel`, { key: randomUUID(), body: { expectedRevision: current.revision } }), params(first.id)));
  assert.equal(cancelled.body.data.state, "cancelled");
  assert.equal(ig.publishCalls, 0);

  // A cancelled post frees the payload; the account is then disconnected before delivery → paused.
  const second = (await post(postBody(f))).body.data;
  assert.notEqual(second.id, first.id);
  await h.db.collection("instagramConnections").updateOne({ ownerId: h.users.a.id }, { $set: { state: "disconnected" } });
  assert.equal(await advancePublish(h.db, second.id), "paused_auth");
  current = (await getIntent(second.id)).body.data;
  assert.deepEqual([current.actions.reconnect, current.actions.retry], [true, true]);
  assert.equal((await json(await routes.retry.POST(h.request("POST", `/api/publish-intents/${second.id}/retry`, { key: randomUUID(), body: { expectedRevision: current.revision, confirm: true } }), params(second.id)))).body.error.code, "RECONNECT_REQUIRED");
  await h.db.collection("instagramConnections").updateOne({ ownerId: h.users.a.id }, { $set: { state: "connected" } });
  // Past the 15-minute window: no post, and retry is refused.
  await h.db.collection("publishIntents").updateOne({ _id: second.id as never }, { $set: { dueAt: new Date(Date.now() - 30 * 60_000), retryDeadlineAt: new Date(Date.now() - 15 * 60_000), createdAt: new Date(Date.now() - 30 * 60_000) } });
  current = (await getIntent(second.id)).body.data;
  assert.equal(current.actions.retry, false);
  assert.equal((await json(await routes.retry.POST(h.request("POST", `/api/publish-intents/${second.id}/retry`, { key: randomUUID(), body: { expectedRevision: current.revision, confirm: true } }), params(second.id)))).body.error.code, "RETRY_WINDOW_EXPIRED");
  assert.equal(ig.containers.length, 1);
});

test("concurrent workers create one container, and the minute scanner recovers due work", async () => {
  const f = await fixture();
  const intent = (await post(postBody(f))).body.data;
  const results = await Promise.all([advancePublish(h.db, intent.id), advancePublish(h.db, intent.id), advancePublish(h.db, intent.id)]);
  assert.deepEqual(results.filter((r) => r === "processing").length, 1);
  assert.equal(ig.containers.length, 1);
  await h.db.collection("publishIntents").updateOne({ _id: intent.id as never }, { $set: { nextCheckAt: new Date(Date.now() - 1000) } });
  const scanned = await advanceDueIntents(h.db);
  assert.equal(scanned.published, 1, JSON.stringify(scanned));
  assert.equal((await getIntent(intent.id)).body.data.state, "published");
  assert.equal(ig.publishCalls, 1);
});
