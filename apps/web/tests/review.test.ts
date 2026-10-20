// F10 backend: applying a storyboard candidate (S06) and editing the working storyboard (DraftPlanV2) via autosave.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import realPlan from "./fixtures/plan-dns.json";
import { commandIdentity } from "../server/commands";
import { acceptStoryboard, runStoryboard, storyboardContentHash } from "../server/storyboards/service";
import type { PlanV2 } from "../lib/plan";
import { json, params, startHarness, type Harness } from "./harness";

let h: Harness;
let routes: {
  projects: typeof import("../app/api/projects/route");
  project: typeof import("../app/api/projects/[id]/route");
  draft: typeof import("../app/api/projects/[id]/draft/route");
  apply: typeof import("../app/api/projects/[id]/draft/apply/route");
};
const plan = realPlan as PlanV2;
const hash = storyboardContentHash(plan);

before(async () => {
  h = await startHarness("f10", ["a", "b"]);
  routes = {
    projects: await import("../app/api/projects/route"),
    project: await import("../app/api/projects/[id]/route"),
    draft: await import("../app/api/projects/[id]/draft/route"),
    apply: await import("../app/api/projects/[id]/draft/apply/route"),
  };
});
after(() => h?.stop());

/** Project with a saved topic (draft revision 2) and one generated storyboard candidate. */
async function projectWithStoryboard(user = "a", content: PlanV2 = plan) {
  const project = (await json(await routes.projects.POST(h.request("POST", "/api/projects", { user, body: {}, key: randomUUID() })))).body.data;
  await routes.draft.PATCH(h.request("PATCH", `/api/projects/${project.id}/draft`, { user, body: { expectedRevision: 1, changes: { topic: "How DNS works" } } }), params(project.id));
  const body = { expectedDraftRevision: 2 };
  const identity = commandIdentity(new Request("http://x", { method: "POST", headers: { "idempotency-key": randomUUID() } }), h.users[user].id, `/api/projects/${project.id}/storyboards`, body);
  const { jobId } = await acceptStoryboard(h.services, identity, project.id, body);
  await runStoryboard(h.services, jobId, async () => ({ plan: content, warnings: [], attempts: 1 }), "test");
  const storyboard = await h.db.collection("storyboards").findOne({ projectId: project.id });
  return { projectId: project.id as string, storyboardId: String(storyboard?._id) };
}
const apply = async (projectId: string, body: unknown, options: { user?: string; key?: string } = {}) =>
  json(await routes.apply.POST(h.request("POST", `/api/projects/${projectId}/draft/apply`, { body, key: options.key ?? randomUUID(), user: options.user }), params(projectId)));
const save = async (projectId: string, body: unknown) => json(await routes.draft.PATCH(h.request("PATCH", `/api/projects/${projectId}/draft`, { body }), params(projectId)));

test("applying a candidate copies it into the working draft and points the project at it; replays are idempotent", async () => {
  const { projectId, storyboardId } = await projectWithStoryboard();
  const key = randomUUID();
  const applied = await apply(projectId, { expectedDraftRevision: 2, storyboardId, expectedContentHash: hash }, { key });
  assert.equal(applied.status, 200);
  const draft = applied.body.data;
  assert.deepEqual([draft.revision, draft.sourceStoryboardId, draft.planStale, draft.validation.valid], [3, storyboardId, false, true]);
  assert.deepEqual(draft.editablePlan, plan);
  const project = (await json(await routes.project.GET(h.request("GET", `/api/projects/${projectId}`), params(projectId)))).body.data;
  assert.deepEqual([project.currentStoryboardId, project.draftRevision], [storyboardId, 3]);

  const replay = await apply(projectId, { expectedDraftRevision: 2, storyboardId, expectedContentHash: hash }, { key });
  assert.deepEqual([replay.status, replay.headers.get("idempotency-replayed"), replay.body.data.revision], [200, "true", 3]);
});

test("apply rejects a changed hash, a stale revision, another user's or project's storyboard and a narrator mismatch", async () => {
  const { projectId, storyboardId } = await projectWithStoryboard();
  assert.equal((await apply(projectId, { expectedDraftRevision: 2, storyboardId, expectedContentHash: "0".repeat(64) })).body.error.code, "HASH_MISMATCH");
  assert.equal((await apply(projectId, { expectedDraftRevision: 1, storyboardId, expectedContentHash: hash })).body.error.code, "REVISION_CONFLICT");
  assert.equal((await apply(projectId, { expectedDraftRevision: 2, storyboardId, expectedContentHash: hash }, { user: "b" })).status, 404);
  const other = await projectWithStoryboard();
  assert.equal((await apply(projectId, { expectedDraftRevision: 2, storyboardId: other.storyboardId, expectedContentHash: hash })).status, 404);
  assert.equal((await apply(projectId, { expectedDraftRevision: 2, storyboardId, expectedContentHash: hash, extra: 1 })).status, 422);

  const mismatched = await projectWithStoryboard("a", { ...plan, voicePreset: "indian-english-male" });
  const result = await apply(mismatched.projectId, { expectedDraftRevision: 2, storyboardId: mismatched.storyboardId, expectedContentHash: storyboardContentHash({ ...plan, voicePreset: "indian-english-male" }) });
  assert.deepEqual([result.status, result.body.error.fieldErrors[0].code], [422, "VOICE_MISMATCH"]);
});

test("edits to the working storyboard autosave; incomplete text is kept with issues, unsafe structure is rejected", async () => {
  const { projectId, storyboardId } = await projectWithStoryboard();
  await apply(projectId, { expectedDraftRevision: 2, storyboardId, expectedContentHash: hash });
  let revision = 3;
  const edit = async (mutate: (p: PlanV2) => void) => {
    const next = structuredClone(plan);
    mutate(next);
    const r = await save(projectId, { expectedRevision: revision, changes: { editablePlan: next } });
    if (r.status === 200) revision = r.body.data.revision;
    return r;
  };

  const edited = await edit((p) => { p.scenes[0].narration = `${p.scenes[0].narration} Here is one more clear sentence.`; });
  assert.deepEqual([edited.status, edited.body.data.validation.valid], [200, true]);
  assert.match(edited.body.data.editablePlan.scenes[0].narration, /one more clear sentence/);

  const cueGone = await edit((p) => { p.scenes[0].narration = "A completely rewritten narration that no longer mentions the original visual phrase."; });
  assert.equal(cueGone.status, 200);
  assert.ok(cueGone.body.data.validation.issues.some((i: { path: string; code: string }) => i.code === "CUE_NOT_FOUND" && i.path.startsWith("editablePlan.scenes.0")));

  const emptyLabel = await edit((p) => { (p.scenes[0].visual.data as { steps: { label: string }[] }).steps[0].label = ""; });
  assert.equal(emptyLabel.status, 200);
  assert.equal(emptyLabel.body.data.validation.valid, false);

  for (const unsafe of [
    (p: PlanV2) => { (p.scenes[0].visual as { component: string }).component = "chart"; },
    (p: PlanV2) => { (p.scenes[0] as unknown as Record<string, unknown>).script = "<script>"; },
    (p: PlanV2) => { p.scenes = p.scenes.slice(0, 1); },
    (p: PlanV2) => { (p.scenes[0].visual.data as { steps: unknown[] }).steps = []; },
    (p: PlanV2) => { p.scenes[0].narration = "x".repeat(3000); },
  ]) {
    const r = await edit(unsafe);
    assert.deepEqual([r.status, r.body.error.code], [422, "INVALID_DRAFT"]);
  }
  const huge = await save(projectId, { expectedRevision: revision, changes: { editablePlan: { ...plan, padding: "x".repeat(140_000) } } });
  assert.equal(huge.status, 422);
});

test("changing the idea marks the working storyboard stale, and storyboard creation is not blocked by plan issues", async () => {
  const { projectId, storyboardId } = await projectWithStoryboard();
  await apply(projectId, { expectedDraftRevision: 2, storyboardId, expectedContentHash: hash });
  const broken = structuredClone(plan);
  broken.scenes[0].narration = "Rewritten narration without the cue words for this scene at all.";
  await save(projectId, { expectedRevision: 3, changes: { editablePlan: broken } });
  const stale = await save(projectId, { expectedRevision: 4, changes: { topic: "How DNS caching works" } });
  assert.deepEqual([stale.status, stale.body.data.planStale], [200, true]);

  const body = { expectedDraftRevision: 5 };
  const identity = commandIdentity(new Request("http://x", { method: "POST", headers: { "idempotency-key": randomUUID() } }), h.users.a.id, `/api/projects/${projectId}/storyboards`, body);
  assert.ok((await acceptStoryboard(h.services, identity, projectId, body)).jobId);
});
