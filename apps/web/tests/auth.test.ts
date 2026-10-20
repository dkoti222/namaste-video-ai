// F03 integration tests: real Better Auth + MongoDB replica set, exercised through the session facade handlers.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { MongoClient, type Db } from "mongodb";
import { createAuth, SESSION_MAX_SECONDS, type AuthServices } from "../server/auth/auth";
import { AuthConfigError, readAuthConfig } from "../server/auth/config";
import { disableAccess, enableAccess, provisionUser, ProvisioningError, resetPassword } from "../server/auth/provisioning";
import { getSessionResponse, signIn, signOut } from "../server/auth/session";
import { DEFAULT_LOGIN_LIMITS } from "../server/auth/rate-limit";
import { runMigrations } from "../server/db/migrations";
import { handle } from "../server/http";

const ORIGIN = "http://127.0.0.1:3000";
const PASSWORD = "correct horse battery";

let replSet: MongoMemoryReplSet;
let client: MongoClient;
let db: Db;
let services: AuthServices;
let ipCounter = 0;

before(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  client = await new MongoClient(replSet.getUri()).connect();
  db = client.db(`f03_test_${process.pid}`);
  await runMigrations(db);
  const config = { secret: "test-secret-".padEnd(48, "x"), origin: ORIGIN };
  services = { db, client, config, auth: createAuth({ db, client, config }), limits: DEFAULT_LOGIN_LIMITS };
});
after(async () => {
  await client?.close();
  await replSet?.stop();
});

const provision = (email: string, password = PASSWORD) => provisionUser(services, { email, password, operatorRef: "test" });
const freshIp = () => `203.0.113.${++ipCounter}`;

function request(urlPath: string, init: { method?: string; body?: unknown; cookie?: string; origin?: string | null; ip?: string; contentType?: string } = {}) {
  const headers = new Headers({ "x-forwarded-for": init.ip ?? freshIp() });
  if (init.origin !== null) headers.set("origin", init.origin ?? ORIGIN);
  if (init.cookie) headers.set("cookie", init.cookie);
  if (init.body !== undefined) headers.set("content-type", init.contentType ?? "application/json");
  return new Request(`${ORIGIN}${urlPath}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : typeof init.body === "string" ? init.body : JSON.stringify(init.body),
  });
}

const callSignIn = (body: unknown, init: Parameters<typeof request>[1] = {}) =>
  handle((id) => signIn(request("/api/session/sign-in", { method: "POST", body, ...init }), services, id));
const callSession = (cookie?: string) => handle((id) => getSessionResponse(request("/api/session", { cookie }), services, id));
const callSignOut = (cookie?: string, origin?: string | null) =>
  handle((id) => signOut(request("/api/session/sign-out", { method: "POST", body: {}, cookie, origin }), services, id));

/** Session cookie as a Cookie request header, taken from Set-Cookie. */
const cookieFrom = (response: Response) =>
  response.headers.getSetCookie().map((c) => c.split(";")[0]).filter((c) => !c.endsWith("=")).join("; ");

async function errorOf(response: Response) {
  const body = await response.json();
  return { status: response.status, code: body.error?.code, message: body.error?.message };
}

async function signedIn(email: string, password = PASSWORD) {
  const response = await callSignIn({ email, password });
  assert.equal(response.status, 200);
  return cookieFrom(response);
}

test("auth configuration fails clearly without a strong secret or valid origin", () => {
  assert.throws(() => readAuthConfig({}), AuthConfigError);
  assert.throws(() => readAuthConfig({ BETTER_AUTH_SECRET: "short", BETTER_AUTH_URL: ORIGIN }), /32 random characters/);
  assert.throws(() => readAuthConfig({ BETTER_AUTH_SECRET: "x".repeat(32) }), /BETTER_AUTH_URL/);
  assert.throws(() => readAuthConfig({ BETTER_AUTH_SECRET: "x".repeat(32), BETTER_AUTH_URL: `${ORIGIN}/app` }), /without a path/);
  assert.deepEqual(readAuthConfig({ BETTER_AUTH_SECRET: "x".repeat(32), BETTER_AUTH_URL: `${ORIGIN}/` }), { secret: "x".repeat(32), origin: ORIGIN });
});

test("public signup is disabled and no native auth route is mounted", async () => {
  await assert.rejects(
    services.auth.api.signUpEmail({ body: { email: "outsider@example.com", password: PASSWORD, name: "Outsider" } }),
    /sign up is not enabled/i,
  );
  assert.equal(await db.collection("user").countDocuments({ email: "outsider@example.com" }), 0);
  const apiDir = path.join(import.meta.dirname, "..", "app", "api");
  assert.ok(!fs.readdirSync(apiDir).includes("auth"), "Better Auth native handler must not be mounted");
});

test("provisioning is idempotent, never overwrites a password and requires 12 characters", async () => {
  await assert.rejects(provision("short@example.com", "elevenchars"), ProvisioningError);
  await assert.rejects(provision("not-an-email", PASSWORD), ProvisioningError);

  const first = await provision("  Creator@Example.com ");
  assert.equal(first.createdUser, true);
  const access = await db.collection("internalAccess").findOne({ normalizedEmail: "creator@example.com" });
  assert.deepEqual([access?.provisioningState, access?.enabled, access?.provisionedUserId], ["active", true, first.userId]);

  const again = await provision("creator@example.com", "a different password");
  assert.deepEqual(again, { userId: first.userId, createdUser: false });
  assert.equal(await db.collection("user").countDocuments({ email: "creator@example.com" }), 1);
  await signedIn("creator@example.com"); // original password still valid
  const stored = await db.collection("account").findOne({ providerId: "credential" });
  assert.ok(stored && !JSON.stringify(stored).includes(PASSWORD), "password is stored only as a hash");
});

test("sign-in returns the SessionView with an HttpOnly cookie and no token, and the session is readable", async () => {
  const { userId } = await provision("viewer@example.com");
  const response = await callSignIn({ email: "Viewer@Example.com", password: PASSWORD });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.match(response.headers.get("x-request-id") ?? "", /^req_/);
  const cookies = response.headers.getSetCookie();
  assert.ok(cookies.some((c) => /session_token=/.test(c) && /HttpOnly/i.test(c) && /SameSite=Lax/i.test(c)));

  const body = await response.json();
  assert.deepEqual(Object.keys(body.data).sort(), ["capabilities", "expiresAt", "user", "workspaceId"]);
  assert.deepEqual(body.data.user, { id: userId, email: "viewer@example.com", name: "viewer" });
  assert.equal(body.data.workspaceId, userId);
  assert.deepEqual(body.data.capabilities, { generation: false, instagramPublishing: false });
  assert.ok(!JSON.stringify(body).match(/token|password|hash/i));
  const lifetime = (Date.parse(body.data.expiresAt) - Date.now()) / 1000;
  assert.ok(Math.abs(lifetime - SESSION_MAX_SECONDS) < 60, `seven-day session, got ${lifetime}s`);

  const session = await callSession(cookieFrom(response));
  assert.equal(session.status, 200);
  assert.equal((await session.json()).data.user.id, userId);
});

test("wrong password, unknown email and accounts without admission get the same generic error", async () => {
  await provision("member@example.com");
  // An auth user without an access record cannot obtain a session (session hook) even with the right password.
  const context = await services.auth.$context;
  const orphan = await context.internalAdapter.createUser({ email: "orphan@example.com", name: "Orphan", emailVerified: true }, { method: "admin" });
  await context.internalAdapter.linkAccount({ userId: orphan.id, providerId: "credential", accountId: orphan.id, password: await context.password.hash(PASSWORD) });
  // An allowlist entry alone (pending, no user) does not admit anyone.
  await db.collection("internalAccess").insertOne({
    _id: "acc_pendingonly0000001", schemaVersion: 1, normalizedEmail: "pending@example.com", enabled: true,
    provisioningState: "pending", operatorRef: "test", createdAt: new Date(), updatedAt: new Date(),
  } as never);

  const results = await Promise.all([
    callSignIn({ email: "member@example.com", password: "wrong password!!" }).then(errorOf),
    callSignIn({ email: "nobody@example.com", password: PASSWORD }).then(errorOf),
    callSignIn({ email: "orphan@example.com", password: PASSWORD }).then(errorOf),
    callSignIn({ email: "pending@example.com", password: PASSWORD }).then(errorOf),
    callSignIn({ email: "not an email", password: PASSWORD }).then(errorOf),
  ]);
  for (const result of results) {
    assert.deepEqual(result, { status: 401, code: "INVALID_CREDENTIALS", message: "The email or password is incorrect." });
  }
  assert.equal(await db.collection("session").countDocuments({ userId: orphan.id }), 0);
});

test("requests are validated: Origin, JSON, content type, unknown fields and empty password", async () => {
  await provision("strict@example.com");
  const good = { email: "strict@example.com", password: PASSWORD };
  assert.deepEqual(await errorOf(await callSignIn(good, { origin: null })), {
    status: 403, code: "ORIGIN_NOT_ALLOWED", message: "This request did not come from the NamasteVideo app. Reload the page and try again.",
  });
  assert.equal((await errorOf(await callSignIn(good, { origin: "https://evil.example" }))).code, "ORIGIN_NOT_ALLOWED");
  assert.equal((await errorOf(await callSignIn("{not json"))).code, "MALFORMED_JSON");
  assert.equal((await errorOf(await callSignIn("email=a", { contentType: "application/x-www-form-urlencoded" }))).status, 415);
  assert.equal((await errorOf(await callSignIn({ ...good, rememberMe: false }))).code, "VALIDATION_FAILED");
  assert.equal((await errorOf(await callSignIn({ email: "strict@example.com", password: "" }))).code, "VALIDATION_FAILED");
  assert.equal((await errorOf(await callSignIn("x".repeat(300_000)))).code, "PAYLOAD_TOO_LARGE");
  assert.equal((await errorOf(await callSignOut(undefined, null))).code, "ORIGIN_NOT_ALLOWED");
});

test("failed sign-ins are throttled per email hash and per IP hash without storing raw identifiers", async () => {
  await provision("target@example.com");
  for (let attempt = 0; attempt < 5; attempt++) {
    assert.equal((await callSignIn({ email: "target@example.com", password: "wrong password!!" })).status, 401);
  }
  const blocked = await callSignIn({ email: "target@example.com", password: PASSWORD });
  assert.equal(blocked.status, 429);
  assert.equal((await blocked.json()).error.code, "RATE_LIMITED");
  const retryAfter = Number(blocked.headers.get("retry-after"));
  assert.ok(retryAfter >= 1 && retryAfter <= 900);

  const ip = freshIp();
  await provision("other@example.com");
  for (let attempt = 0; attempt < 30; attempt++) {
    await callSignIn({ email: `spray${attempt}@example.com`, password: "wrong password!!" }, { ip });
  }
  assert.equal((await callSignIn({ email: "other@example.com", password: PASSWORD }, { ip })).status, 429);
  assert.equal((await callSignIn({ email: "other@example.com", password: PASSWORD })).status, 200); // other IP

  const stored = JSON.stringify(await db.collection("rateLimitBuckets").find().toArray());
  assert.ok(!stored.includes("target@example.com") && !stored.includes(ip));
});

test("sign-out ends only this session, expires the cookie and is idempotent", async () => {
  await provision("leaver@example.com");
  const first = await signedIn("leaver@example.com");
  const second = await signedIn("leaver@example.com");

  const response = await callSignOut(first);
  assert.equal(response.status, 204);
  assert.ok(response.headers.getSetCookie().some((c) => /session_token=;/.test(c) && /Max-Age=0/i.test(c)));
  assert.equal((await errorOf(await callSession(first))).code, "SESSION_EXPIRED");
  assert.equal((await callSession(second)).status, 200);
  assert.equal((await callSignOut(first)).status, 204);
  assert.equal((await callSignOut()).status, 204);
});

test("missing and invalid sessions return 401", async () => {
  assert.equal((await errorOf(await callSession())).code, "UNAUTHENTICATED");
  assert.equal((await errorOf(await callSession("better-auth.session_token=forged.value"))).code, "SESSION_EXPIRED");
});

test("disabling access revokes sessions and blocks sign-in; enabling restores it", async () => {
  await provision("paused@example.com");
  const cookie = await signedIn("paused@example.com");
  await disableAccess(services, "paused@example.com");
  assert.equal((await errorOf(await callSession(cookie))).code, "SESSION_EXPIRED");
  assert.equal((await errorOf(await callSignIn({ email: "paused@example.com", password: PASSWORD }))).code, "INVALID_CREDENTIALS");
  await assert.rejects(provision("paused@example.com"), /disabled/);

  await enableAccess(services, "paused@example.com");
  await signedIn("paused@example.com");
});

test("an authenticated session whose access was disabled gets 403 ACCESS_DISABLED", async () => {
  await provision("revalidate@example.com");
  const cookie = await signedIn("revalidate@example.com");
  await db.collection("internalAccess").updateOne({ normalizedEmail: "revalidate@example.com" }, { $set: { enabled: false } });
  assert.deepEqual(await errorOf(await callSession(cookie)), {
    status: 403, code: "ACCESS_DISABLED", message: "Your access to NamasteVideo is disabled. Contact the operator.",
  });
});

test("operator password reset revokes sessions and replaces the password", async () => {
  await provision("forgetful@example.com");
  const cookie = await signedIn("forgetful@example.com");
  await resetPassword(services, "forgetful@example.com", "a brand new passphrase");
  assert.equal((await callSession(cookie)).status, 401);
  assert.equal((await callSignIn({ email: "forgetful@example.com", password: PASSWORD })).status, 401);
  await signedIn("forgetful@example.com", "a brand new passphrase");
});
