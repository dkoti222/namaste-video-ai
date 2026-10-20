// F17: personal preferences (P08/P09) — timezone and future-project default voice, per-user isolation,
// revision conflicts, and no effect on existing projects.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { canonicalTimezone, timezoneList, utcOffsetLabel } from "../lib/timezones";
import { json, params, startHarness, type Harness } from "./harness";

let h: Harness;
let routes: {
  prefs: typeof import("../app/api/preferences/route");
  projects: typeof import("../app/api/projects/route");
  draft: typeof import("../app/api/projects/[id]/draft/route");
};
const savedEnv = process.env.ELEVENLABS_VOICE_ID_INDIAN_FEMALE;

before(async () => {
  process.env.ELEVENLABS_VOICE_ID_INDIAN_FEMALE = "voice-test-female";
  h = await startHarness("f17", ["a", "b"]);
  routes = {
    prefs: await import("../app/api/preferences/route"),
    projects: await import("../app/api/projects/route"),
    draft: await import("../app/api/projects/[id]/draft/route"),
  };
});
after(async () => {
  if (savedEnv === undefined) delete process.env.ELEVENLABS_VOICE_ID_INDIAN_FEMALE;
  else process.env.ELEVENLABS_VOICE_ID_INDIAN_FEMALE = savedEnv;
  await h?.stop();
});

const get = async (user = "a") => json(await routes.prefs.GET(h.request("GET", "/api/preferences", { user })));
const patch = async (body: unknown, user = "a", origin?: string | null) => json(await routes.prefs.PATCH(h.request("PATCH", "/api/preferences", { user, body, origin })));
const newProjectVoice = async (user = "a") => {
  const project = (await json(await routes.projects.POST(h.request("POST", "/api/projects", { user, body: {}, key: randomUUID() })))).body.data;
  return (await json(await routes.draft.GET(h.request("GET", `/api/projects/${project.id}/draft`, { user }), params(project.id)))).body.data.voicePreset as string;
};

test("timezone helpers use modern IANA names, aliases and DST-aware offsets", () => {
  assert.equal(canonicalTimezone("Asia/Kolkata"), "Asia/Kolkata");
  assert.equal(canonicalTimezone("Asia/Calcutta"), "Asia/Kolkata");
  assert.equal(canonicalTimezone("asia/kolkata"), "Asia/Kolkata");
  assert.equal(canonicalTimezone("Etc/UTC"), "UTC");
  for (const bad of ["Mars/Base", "", "Asia/Kolkata; drop", "../etc"]) assert.equal(canonicalTimezone(bad), null, bad);
  const list = timezoneList();
  assert.ok(list.includes("Asia/Kolkata") && list.includes("UTC") && !list.includes("Asia/Calcutta"));
  assert.equal(utcOffsetLabel("Asia/Kolkata"), "GMT+05:30");
  assert.equal(utcOffsetLabel("America/New_York", new Date("2026-01-15T12:00:00Z")), "GMT-05:00");
  assert.equal(utcOffsetLabel("America/New_York", new Date("2026-07-15T12:00:00Z")), "GMT-04:00");
});

test("unsaved preferences read as defaults; first save creates them and new projects use the default voice", async () => {
  assert.deepEqual((await get()).body.data, { revision: 0, timezone: null, defaultVoicePreset: "daniel-test" });
  const before = await newProjectVoice();
  assert.equal(before, "daniel-test");

  const saved = await patch({ expectedRevision: 0, timezone: "asia/calcutta", defaultVoicePreset: "indian-english-female" });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.body.data, { revision: 1, timezone: "Asia/Kolkata", defaultVoicePreset: "indian-english-female" });
  assert.deepEqual((await get()).body.data, saved.body.data);
  assert.equal(await newProjectVoice(), "indian-english-female", "future projects use the new default");

  const updated = await patch({ expectedRevision: 1, timezone: "Europe/London" });
  assert.deepEqual(updated.body.data, { revision: 2, timezone: "Europe/London", defaultVoicePreset: "indian-english-female" });
});

test("changing the default never rewrites existing projects", async () => {
  const current = (await get()).body.data;
  const project = (await json(await routes.projects.POST(h.request("POST", "/api/projects", { body: {}, key: randomUUID() })))).body.data;
  await patch({ expectedRevision: current.revision, defaultVoicePreset: "daniel-test" });
  const draft = (await json(await routes.draft.GET(h.request("GET", `/api/projects/${project.id}/draft`), params(project.id)))).body.data;
  assert.equal(draft.voicePreset, current.defaultVoicePreset, "existing draft keeps the voice it was created with");
  assert.equal(await newProjectVoice(), "daniel-test");
});

test("invalid timezone, unavailable voice, stale revision and malformed bodies are rejected", async () => {
  const { revision } = (await get()).body.data;
  const badZone = await patch({ expectedRevision: revision, timezone: "Mars/Base" });
  assert.deepEqual([badZone.status, badZone.body.error.code, badZone.body.error.fieldErrors[0].path], [422, "INVALID_TIMEZONE", "timezone"]);
  const badVoice = await patch({ expectedRevision: revision, defaultVoicePreset: "indian-english-male" });
  assert.deepEqual([badVoice.status, badVoice.body.error.code], [422, "VOICE_UNAVAILABLE"], "unconfigured preset");
  const stale = await patch({ expectedRevision: revision - 1, timezone: "UTC" });
  assert.deepEqual([stale.status, stale.body.error.code, stale.body.error.details.currentRevision], [409, "REVISION_CONFLICT", revision]);
  const recreate = await patch({ expectedRevision: 0, timezone: "UTC" });
  assert.equal(recreate.body.error.code, "REVISION_CONFLICT", "first-save race maps to a conflict");
  for (const body of [{ expectedRevision: revision }, { expectedRevision: revision, timezone: "UTC", extra: 1 }, { timezone: "UTC" }]) {
    assert.equal((await patch(body)).status, 422, JSON.stringify(body));
  }
  assert.equal((await patch({ expectedRevision: revision, timezone: "UTC" }, "a", "https://evil.example")).status, 403, "cross-origin mutation refused");
  assert.equal((await get()).body.data.revision, revision, "nothing changed");
});

test("preferences are isolated per user and a removed voice falls back for new projects", async () => {
  assert.deepEqual((await get("b")).body.data, { revision: 0, timezone: null, defaultVoicePreset: "daniel-test" });
  await patch({ expectedRevision: 0, timezone: "America/New_York", defaultVoicePreset: "indian-english-female" }, "b");
  assert.notEqual((await get("a")).body.data.timezone, "America/New_York");
  delete process.env.ELEVENLABS_VOICE_ID_INDIAN_FEMALE;
  try {
    assert.equal(await newProjectVoice("b"), "daniel-test");
  } finally {
    process.env.ELEVENLABS_VOICE_ID_INDIAN_FEMALE = "voice-test-female";
  }
  const signedOut = await routes.prefs.GET(new Request("http://127.0.0.1:3000/api/preferences"));
  assert.equal(signedOut.status, 401);
});
