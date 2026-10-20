// F18: Instagram connection (I01–I04) with a fake provider — session-bound one-use state, encrypted tokens,
// eligibility, account reservation, reconnect epochs, disconnect and token refresh.
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readInstagramConfig } from "../server/instagram/config";
import { decryptToken, encryptToken } from "../server/instagram/crypto";
import { InstagramProviderError, normalizeAccountType, setInstagramProviderForTests, type InstagramProvider } from "../server/instagram/provider";
import { refreshConnection, refreshDueConnections } from "../server/instagram/service";
import { sha256Hex } from "../lib/canonical";
import { json, startHarness, type Harness } from "./harness";

const ENV = {
  INSTAGRAM_APP_ID: "123456789012345",
  INSTAGRAM_APP_SECRET: "test-app-secret",
  INSTAGRAM_REDIRECT_URI: "https://localhost:3000/api/instagram/callback",
  INSTAGRAM_TOKEN_KEY: "ab".repeat(32),
};
let h: Harness;
let routes: {
  connect: typeof import("../app/api/instagram/connect/route");
  callback: typeof import("../app/api/instagram/callback/route");
  connection: typeof import("../app/api/instagram/connection/route");
  projects: typeof import("../app/api/projects/route");
};

// Fake Instagram: each code maps to an account; tokens are unique strings so we can check they never leak.
type Account = { userId: string; username: string; type: string; permissions?: string[] };
const accounts = new Map<string, Account>();
const calls = { exchange: 0, refresh: 0 };
let refreshMode: "ok" | "rejected" | "down" = "ok";
const fake: InstagramProvider = {
  authorizationUrl: (state) => `https://www.instagram.com/oauth/authorize?client_id=${ENV.INSTAGRAM_APP_ID}&redirect_uri=${encodeURIComponent(ENV.INSTAGRAM_REDIRECT_URI)}&response_type=code&scope=instagram_business_basic,instagram_business_content_publish&state=${state}`,
  async exchangeCode(code) {
    calls.exchange++;
    const account = accounts.get(code);
    if (!account) throw new InstagramProviderError("PROVIDER_REJECTED", "bad code", 400);
    return { accessToken: `short-${code}`, userId: `app-scoped-${account.userId}`, permissions: account.permissions ?? ["instagram_business_basic", "instagram_business_content_publish"] };
  },
  async longLivedToken(token) {
    return { accessToken: `SECRET-long-${token}-${randomUUID()}`, expiresInSeconds: 60 * 24 * 3600 };
  },
  async refreshToken(token) {
    calls.refresh++;
    if (refreshMode === "rejected") throw new InstagramProviderError("PROVIDER_REJECTED", "expired", 400);
    if (refreshMode === "down") throw new InstagramProviderError("PROVIDER_UNAVAILABLE", "down");
    return { accessToken: `SECRET-refreshed-${token.slice(0, 12)}-${randomUUID()}`, expiresInSeconds: 60 * 24 * 3600 };
  },
  async account(token) {
    const code = token.split("short-")[1]?.split("-")[0] ?? "";
    const account = accounts.get(code)!;
    return { userId: account.userId, username: account.username, accountType: normalizeAccountType(account.type) };
  },
};

const saved: Record<string, string | undefined> = {};
before(async () => {
  for (const [k, v] of Object.entries(ENV)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  setInstagramProviderForTests(fake);
  h = await startHarness("f18", ["a", "b"]);
  routes = {
    connect: await import("../app/api/instagram/connect/route"),
    callback: await import("../app/api/instagram/callback/route"),
    connection: await import("../app/api/instagram/connection/route"),
    projects: await import("../app/api/projects/route"),
  };
});
after(async () => {
  setInstagramProviderForTests(undefined);
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await h?.stop();
});
beforeEach(() => {
  refreshMode = "ok";
});

const startConnect = async (user = "a", body: unknown = {}) => json(await routes.connect.POST(h.request("POST", "/api/instagram/connect", { user, body })));
const stateOf = (url: string) => new URL(url).searchParams.get("state")!;
async function callback(query: Record<string, string>, user: string | null = "a") {
  const url = `/api/instagram/callback?${new URLSearchParams(query)}`;
  const request = user ? h.request("GET", url, { user }) : new Request(`http://127.0.0.1:3000${url}`);
  const response = await routes.callback.GET(request);
  return { status: response.status, location: response.headers.get("location") };
}
const view = async (user = "a") => (await json(await routes.connection.GET(h.request("GET", "/api/instagram/connection", { user })))).body.data;
const remove = async (body: unknown, user = "a", key = randomUUID()) => json(await routes.connection.DELETE(h.request("DELETE", "/api/instagram/connection", { user, body, key })));
async function connectAs(code: string, account: Account, user = "a") {
  accounts.set(code, account);
  const { body } = await startConnect(user);
  return callback({ code, state: stateOf(body.data.authorizationUrl) }, user);
}

test("configuration requires HTTPS redirect and a 32-byte key; tokens use AES-256-GCM bound to owner and connection", () => {
  assert.equal(readInstagramConfig({ ...ENV, INSTAGRAM_REDIRECT_URI: "http://127.0.0.1:3000/api/instagram/callback" }), null);
  assert.equal(readInstagramConfig({ ...ENV, INSTAGRAM_TOKEN_KEY: "short" }), null);
  assert.equal(readInstagramConfig({ ...ENV, INSTAGRAM_APP_SECRET: "" }), null);
  const config = readInstagramConfig(ENV)!;
  const a = encryptToken(config, "user-a", "igc_1", "token-value");
  const b = encryptToken(config, "user-a", "igc_1", "token-value");
  assert.notDeepEqual(a.nonce.buffer, b.nonce.buffer, "unique nonce per encryption");
  assert.equal(decryptToken(config, "user-a", "igc_1", a), "token-value");
  assert.throws(() => decryptToken(config, "user-b", "igc_1", a), "other owner cannot decrypt");
  assert.throws(() => decryptToken(config, "user-a", "igc_2", a), "other connection cannot decrypt");
  assert.deepEqual(["BUSINESS", "Business", "MEDIA_CREATOR", "CREATOR", "PERSONAL", undefined].map(normalizeAccountType), ["BUSINESS", "BUSINESS", "CREATOR", "CREATOR", "UNSUPPORTED", "UNSUPPORTED"]);
});

test("I01 returns an allowlisted Instagram URL with a one-use state stored only as a hash", async () => {
  const { status, body } = await startConnect();
  assert.equal(status, 200);
  const url = new URL(body.data.authorizationUrl);
  assert.equal(url.origin + url.pathname, "https://www.instagram.com/oauth/authorize");
  assert.equal(url.searchParams.get("scope"), "instagram_business_basic,instagram_business_content_publish");
  const state = stateOf(body.data.authorizationUrl);
  assert.ok(state.length >= 40);
  const stored = await h.db.collection("oauthStates").find({ ownerId: h.users.a.id }).toArray();
  assert.ok(stored.length >= 1 && stored.every((s) => s.stateHash !== state && !JSON.stringify(s).includes(state)));
  assert.ok(new Date(body.data.expiresAt).getTime() - Date.now() <= 10 * 60_000 + 1000);
  assert.equal((await json(await routes.connect.POST(h.request("POST", "/api/instagram/connect", { body: {}, origin: "https://evil.example" })))).status, 403);
  assert.equal((await startConnect("a", { returnProjectId: "prj_doesnotexist000000000" })).status, 404);
});

test("a successful callback connects the account with an encrypted token and never exposes it", async () => {
  const result = await connectAs("codeA1", { userId: "17841400000000001", username: "creator_a", type: "MEDIA_CREATOR" });
  assert.deepEqual(result, { status: 303, location: "/settings?instagram=connected" });
  const v = await view();
  assert.deepEqual([v.state, v.account, v.destinationEpoch, v.publishingAvailable, v.pendingIntentCount], ["connected", { id: "17841400000000001", username: "creator_a", type: "CREATOR" }, 1, false, 0]);
  assert.ok(!JSON.stringify(v).includes("SECRET") && !("scopes" in v) && !("encryptedToken" in v));
  const doc = await h.db.collection("instagramConnections").findOne({ ownerId: h.users.a.id });
  assert.ok(!JSON.stringify(doc).includes("SECRET-long"), "token is not stored in plaintext");
  const config = readInstagramConfig()!;
  assert.match(decryptToken(config, h.users.a.id, String(doc!._id), doc!.encryptedToken), /^SECRET-long-short-codeA1-/);
  assert.ok(doc!.expiresAt.getTime() > Date.now() + 59 * 24 * 3600e3);
});

test("callback states are single use, owner/session bound and expire; cancellations and missing sessions attach nothing", async () => {
  accounts.set("codeX", { userId: "17841400000000099", username: "nobody", type: "BUSINESS" });
  const first = stateOf((await startConnect()).body.data.authorizationUrl);
  assert.equal((await callback({ code: "codeX", state: first }, "b")).location, "/settings?instagram=failed", "another user cannot use the state");
  await h.db.collection("oauthStates").updateOne({ stateHash: sha256Hex(`oauth:${first}`) }, { $set: { initiatingSessionHash: "f".repeat(64) } });
  assert.equal((await callback({ code: "codeX", state: first })).location, "/settings?instagram=failed", "a different sign-in cannot use the state");

  const cancelled = stateOf((await startConnect()).body.data.authorizationUrl);
  assert.equal((await callback({ error: "access_denied", error_reason: "user_denied", state: cancelled })).location, "/settings?instagram=cancelled");
  assert.equal((await callback({ code: "codeX", state: cancelled })).location, "/settings?instagram=failed", "a used state cannot be replayed");

  const late = stateOf((await startConnect()).body.data.authorizationUrl);
  await h.db.collection("oauthStates").updateOne({ stateHash: sha256Hex(`oauth:${late}`) }, { $set: { expiresAt: new Date(Date.now() - 1000), createdAt: new Date(Date.now() - 20 * 60_000) } });
  assert.equal((await callback({ code: "codeX", state: late })).location, "/settings?instagram=expired");

  const lost = stateOf((await startConnect()).body.data.authorizationUrl);
  assert.equal((await callback({ code: "codeX", state: lost }, null)).location, "/settings?instagram=session_lost");
  assert.equal((await callback({ code: "codeX" })).location, "/settings?instagram=failed", "missing state");
  assert.equal(await h.db.collection("instagramConnections").countDocuments({ instagramUserId: "17841400000000099" }), 0);
});

test("personal accounts, missing permissions and accounts owned by someone else are refused without details", async () => {
  assert.equal((await connectAs("codeP", { userId: "17841400000000002", username: "personal", type: "PERSONAL" }, "b")).location, "/settings?instagram=unsupported_account");
  assert.equal((await connectAs("codeM", { userId: "17841400000000003", username: "partial", type: "BUSINESS", permissions: ["instagram_business_basic"] }, "b")).location, "/settings?instagram=missing_permissions");
  assert.equal((await connectAs("codeA2", { userId: "17841400000000001", username: "creator_a", type: "BUSINESS" }, "b")).location, "/settings?instagram=account_in_use");
  assert.equal(await view("b"), null, "nothing attached to b");
  assert.equal((await view("a")).account.username, "creator_a", "a's connection unchanged");
});

test("reconnecting the same account refreshes credentials; a different account changes the destination epoch", async () => {
  const before = await h.db.collection("instagramConnections").findOne({ ownerId: h.users.a.id });
  await connectAs("codeA3", { userId: "17841400000000001", username: "creator_a_renamed", type: "BUSINESS" });
  const same = await h.db.collection("instagramConnections").findOne({ ownerId: h.users.a.id });
  assert.deepEqual([same!.tokenRevision, same!.destinationEpoch, same!.username, same!.accountType], [before!.tokenRevision + 1, before!.destinationEpoch, "creator_a_renamed", "BUSINESS"]);
  await connectAs("codeA4", { userId: "17841400000000004", username: "second_account", type: "BUSINESS" });
  const other = await view();
  assert.deepEqual([other.account.id, other.destinationEpoch], ["17841400000000004", 2]);
});

test("returning to a project after connecting, and connect is unavailable without configuration", async () => {
  const project = (await json(await routes.projects.POST(h.request("POST", "/api/projects", { user: "b", body: {}, key: randomUUID() })))).body.data;
  accounts.set("codeB1", { userId: "17841400000000005", username: "creator_b", type: "BUSINESS" });
  const { body } = await startConnect("b", { returnProjectId: project.id });
  assert.equal((await callback({ code: "codeB1", state: stateOf(body.data.authorizationUrl) }, "b")).location, `/projects/${project.id}/video?instagram=connected`);
  const key = process.env.INSTAGRAM_TOKEN_KEY;
  delete process.env.INSTAGRAM_TOKEN_KEY;
  try {
    const unavailable = await startConnect("b");
    assert.deepEqual([unavailable.status, unavailable.body.error.code], [503, "INTEGRATION_UNAVAILABLE"]);
  } finally {
    process.env.INSTAGRAM_TOKEN_KEY = key;
  }
});

test("I04 disconnect erases credentials, frees the account, is idempotent and checks the revision", async () => {
  const current = await view("b");
  assert.equal((await remove({ expectedRevision: current.revision + 5, confirmPausePending: true }, "b")).body.error.code, "REVISION_CONFLICT");
  assert.equal((await remove({ expectedRevision: current.revision }, "b")).status, 422, "confirmation required");
  const key = randomUUID();
  const first = await remove({ expectedRevision: current.revision, confirmPausePending: true }, "b", key);
  assert.equal(first.status, 200);
  assert.deepEqual([first.body.data.connection.state, first.body.data.connection.account, first.body.data.pausedIntentCount, first.body.data.reconciliationPending], ["disconnected", null, 0, false]);
  const replay = await remove({ expectedRevision: current.revision, confirmPausePending: true }, "b", key);
  assert.equal(replay.headers.get("idempotency-replayed"), "true");
  const doc = await h.db.collection("instagramConnections").findOne({ ownerId: h.users.b.id });
  assert.ok(!doc!.encryptedToken && !doc!.instagramUserId && doc!.scopes.length === 0);
  // The freed account can now be connected by its owner again (or anyone eligible).
  assert.equal((await connectAs("codeB2", { userId: "17841400000000005", username: "creator_b", type: "BUSINESS" }, "b")).location, "/settings?instagram=connected");
  assert.equal((await view("b")).destinationEpoch, 2, "a disconnect always advances the destination epoch");
  assert.equal((await remove({ expectedRevision: 1, confirmPausePending: true }, "a")).body.error.code, "REVISION_CONFLICT");
});

test("token refresh renews near-expiry tokens under CAS; rejection requires reconnect, outages change nothing", async () => {
  const filter = { ownerId: h.users.a.id };
  await h.db.collection("instagramConnections").updateOne(filter, { $set: { expiresAt: new Date(Date.now() + 5 * 24 * 3600e3) } });
  assert.equal((await view()).state, "expiring");
  const before = await h.db.collection("instagramConnections").findOne(filter);
  assert.deepEqual(await refreshDueConnections(h.db), { refreshed: 1 });
  const refreshed = await h.db.collection("instagramConnections").findOne(filter);
  assert.equal(refreshed!.tokenRevision, before!.tokenRevision + 1);
  assert.ok(refreshed!.expiresAt.getTime() > Date.now() + 59 * 24 * 3600e3 && !refreshed!.refreshLease);
  assert.match(decryptToken(readInstagramConfig()!, h.users.a.id, String(refreshed!._id), refreshed!.encryptedToken), /^SECRET-refreshed-/);
  assert.equal((await view()).state, "connected");
  assert.deepEqual(await refreshDueConnections(h.db), {}, "not due any more");

  refreshMode = "down";
  assert.equal(await refreshConnection(h.db, String(refreshed!._id)), "unavailable");
  assert.equal((await view()).state, "connected");
  refreshMode = "rejected";
  assert.equal(await refreshConnection(h.db, String(refreshed!._id)), "rejected");
  assert.equal((await view()).state, "reconnect_required");
  assert.equal(await refreshConnection(h.db, String(refreshed!._id)), "skipped", "reconnect required is not refreshed");
});
