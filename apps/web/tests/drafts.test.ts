// F07 draft API contract tests: CAS autosave, limits, voice availability, isolation and parent fencing.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { draftContentHash } from "../server/drafts/rules";
import { json, params, startHarness, type Harness } from "./harness";

let h: Harness;
let routes: { projects: typeof import("../app/api/projects/route"); project: typeof import("../app/api/projects/[id]/route"); draft: typeof import("../app/api/projects/[id]/draft/route") };

before(async () => {
  h = await startHarness("f07", ["a", "b"]);
  routes = {
    projects: await import("../app/api/projects/route"),
    project: await import("../app/api/projects/[id]/route"),
    draft: await import("../app/api/projects/[id]/draft/route"),
  };
});
after(() => h?.stop());

const newProject = async (user = "a") =>
  (await json(await routes.projects.POST(h.request("POST", "/api/projects", { user, body: {}, key: randomUUID() })))).body.data;
const getDraft = async (id: string, user = "a") => json(await routes.draft.GET(h.request("GET", `/api/projects/${id}/draft`, { user }), params(id)));
const save = async (id: string, body: unknown, options: { user?: string; origin?: string | null } = {}) =>
  json(await routes.draft.PATCH(h.request("PATCH", `/api/projects/${id}/draft`, { body, ...options }), params(id)));

test("a new project's draft is blank, revision 1, Daniel voice, and not yet valid for a storyboard", async () => {
  const project = await newProject();
  const { status, body } = await getDraft(project.id);
  assert.equal(status, 200);
  const draft = body.data;
  assert.deepEqual(
    { revision: draft.revision, topic: draft.topic, audience: draft.audience, notes: draft.notes, voicePreset: draft.voicePreset, editablePlan: draft.editablePlan, conversationId: draft.conversationId },
    { revision: 1, topic: "", audience: "", notes: "", voicePreset: "daniel-test", editablePlan: null, conversationId: project.conversationId },
  );
  assert.deepEqual(draft.validation, { valid: false, issues: [{ path: "topic", code: "REQUIRED", message: "Add a topic to create a storyboard." }] });
  assert.equal(draft.contentHash, draftContentHash({ topic: "", audience: "", notes: "", voicePreset: "daniel-test", editablePlan: null }));
});

test("saving increments the revision, preserves text exactly, updates the hash and mirrors the project", async () => {
  const project = await newProject();
  const topic = "  Explain binary search\nto a beginner  ";
  const saved = await save(project.id, { expectedRevision: 1, changes: { topic, audience: "New programmers" } });
  assert.equal(saved.status, 200);
  const draft = saved.body.data;
  assert.deepEqual([draft.revision, draft.topic, draft.audience, draft.validation.valid], [2, topic, "New programmers", true]);
  assert.equal(draft.contentHash, draftContentHash({ topic, audience: "New programmers", notes: "", voicePreset: "daniel-test", editablePlan: null }));
  const projectNow = (await json(await routes.project.GET(h.request("GET", `/api/projects/${project.id}`), params(project.id)))).body.data;
  assert.equal(projectNow.draftRevision, 2);
  assert.ok(projectNow.updatedAt > project.updatedAt);
  assert.equal((await getDraft(project.id)).body.data.topic, topic); // recoverable after reload

  const restored = await save(project.id, { expectedRevision: 2, changes: { topic: "", audience: "" } });
  assert.equal(restored.body.data.contentHash, (await getDraft((await newProject()).id)).body.data.contentHash);
});

test("a stale revision conflicts without changing the saved draft, and concurrent saves admit exactly one", async () => {
  const project = await newProject();
  await save(project.id, { expectedRevision: 1, changes: { topic: "First tab" } });
  const stale = await save(project.id, { expectedRevision: 1, changes: { topic: "Second tab" } });
  assert.equal(stale.status, 409);
  assert.deepEqual(stale.body.error.details, { currentRevision: 2, reloadUrl: `/api/projects/${project.id}/draft` });
  assert.equal((await getDraft(project.id)).body.data.topic, "First tab");

  const race = await Promise.all([
    save(project.id, { expectedRevision: 2, changes: { notes: "tab A" } }),
    save(project.id, { expectedRevision: 2, changes: { notes: "tab B" } }),
  ]);
  assert.deepEqual(race.map((r) => r.status).sort(), [200, 409]);
  const after = (await getDraft(project.id)).body.data;
  assert.equal(after.revision, 3);
  assert.equal(after.notes, race.find((r) => r.status === 200)!.body.data.notes);
});

test("limits are counted in code points and unsafe or incomplete requests are rejected", async () => {
  const project = await newProject();
  let revision = 1;
  const ok = async (changes: object) => {
    const r = await save(project.id, { expectedRevision: revision, changes });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    revision = r.body.data.revision;
  };
  const rejected = async (body: object) => assert.equal((await save(project.id, body)).body.error.code, "VALIDATION_FAILED", JSON.stringify(body).slice(0, 80));

  await ok({ topic: "🎬".repeat(2000) }); // 2,000 code points, 4,000 UTF-16 units
  await ok({ audience: "a".repeat(200), notes: "n".repeat(20000) });
  await ok({ editablePlan: null });
  await rejected({ expectedRevision: revision, changes: { topic: "t".repeat(2001) } });
  await rejected({ expectedRevision: revision, changes: { audience: "a".repeat(201) } });
  await rejected({ expectedRevision: revision, changes: { notes: "n".repeat(20001) } });
  await rejected({ expectedRevision: revision, changes: {} });
  await rejected({ expectedRevision: revision, changes: { title: "not a draft field" } });
  assert.equal((await save(project.id, { expectedRevision: revision, changes: { editablePlan: { scenes: [] } } })).body.error.code, "INVALID_DRAFT"); // structurally unsafe plan
  await rejected({ changes: { topic: "no precondition" } });
  await rejected({ expectedRevision: revision, changes: { topic: "x" }, ownerId: h.users.b.id });
});

test("only configured voices can be chosen", async () => {
  const project = await newProject();
  const unavailable = await save(project.id, { expectedRevision: 1, changes: { voicePreset: "indian-english-male" } });
  assert.deepEqual([unavailable.status, unavailable.body.error.code], [422, "VOICE_UNAVAILABLE"]);
  assert.equal((await save(project.id, { expectedRevision: 1, changes: { voicePreset: "daniel-test" } })).status, 200);
});

test("drafts are private: other users, deleted projects and malformed IDs get 404; saves need the app Origin", async () => {
  const project = await newProject("a");
  assert.equal((await getDraft(project.id, "b")).status, 404);
  assert.equal((await save(project.id, { expectedRevision: 1, changes: { topic: "hijack" } }, { user: "b" })).status, 404);
  assert.equal((await getDraft("bad-id")).status, 404);
  assert.equal((await save(project.id, { expectedRevision: 1, changes: { topic: "x" } }, { origin: null })).body.error.code, "ORIGIN_NOT_ALLOWED");
  assert.equal((await getDraft(project.id)).body.data.topic, "");

  await routes.project.DELETE(
    h.request("DELETE", `/api/projects/${project.id}`, { body: { expectedRevision: 1, confirm: true }, key: randomUUID() }),
    params(project.id),
  );
  assert.equal((await getDraft(project.id)).status, 404);
  assert.equal((await save(project.id, { expectedRevision: 1, changes: { topic: "after delete" } })).status, 404);
});
