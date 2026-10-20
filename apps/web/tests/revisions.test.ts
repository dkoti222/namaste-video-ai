// F11: conversational revisions (S08), approval (T05 approval half), restore (S07) and immutability.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import realPlan from "./fixtures/plan-dns.json";
import { compilePlan, reviseStoryboard, toModelPlan } from "../server/ai/planner";
import { commandIdentity } from "../server/commands";
import { acceptRevision, acceptStoryboard, approveStoryboard, changedScenes, runRevision, runStoryboard, storyboardContentHash } from "../server/storyboards/service";
import { getJob } from "../server/projects/service";
import { validatePlanV2, type PlanV2 } from "../lib/plan";
import { json, params, startHarness, type Harness } from "./harness";

let h: Harness;
let routes: {
  projects: typeof import("../app/api/projects/route");
  draft: typeof import("../app/api/projects/[id]/draft/route");
  apply: typeof import("../app/api/projects/[id]/draft/apply/route");
  restore: typeof import("../app/api/projects/[id]/draft/restore/route");
  approvals: typeof import("../app/api/projects/[id]/approvals/route");
  one: typeof import("../app/api/storyboards/[id]/route");
};
const plan = realPlan as PlanV2;

before(async () => {
  h = await startHarness("f11", ["a", "b"]);
  routes = {
    projects: await import("../app/api/projects/route"),
    draft: await import("../app/api/projects/[id]/draft/route"),
    apply: await import("../app/api/projects/[id]/draft/apply/route"),
    restore: await import("../app/api/projects/[id]/draft/restore/route"),
    approvals: await import("../app/api/projects/[id]/approvals/route"),
    one: await import("../app/api/storyboards/[id]/route"),
  };
});
after(() => h?.stop());

const identity = (user: string, path: string, body: unknown) =>
  commandIdentity(new Request("http://x", { method: "POST", headers: { "idempotency-key": randomUUID() } }), h.users[user].id, path, body);
const getDraft = async (projectId: string) => (await json(await routes.draft.GET(h.request("GET", `/api/projects/${projectId}/draft`), params(projectId)))).body.data;

/** Project with topic, one generated storyboard applied to the working draft (draft revision 3). */
async function appliedProject(user = "a") {
  const project = (await json(await routes.projects.POST(h.request("POST", "/api/projects", { user, body: {}, key: randomUUID() })))).body.data;
  await routes.draft.PATCH(h.request("PATCH", `/api/projects/${project.id}/draft`, { user, body: { expectedRevision: 1, changes: { topic: "How DNS works" } } }), params(project.id));
  const body = { expectedDraftRevision: 2 };
  const { jobId } = await acceptStoryboard(h.services, identity(user, `/api/projects/${project.id}/storyboards`, body), project.id, body);
  await runStoryboard(h.services, jobId, async () => ({ plan, warnings: [], attempts: 1 }), "test");
  const storyboard = await h.db.collection("storyboards").findOne({ projectId: project.id });
  const storyboardId = String(storyboard?._id);
  await routes.apply.POST(
    h.request("POST", `/api/projects/${project.id}/draft/apply`, { user, key: randomUUID(), body: { expectedDraftRevision: 2, storyboardId, expectedContentHash: storyboardContentHash(plan) } }),
    params(project.id),
  );
  return { projectId: project.id as string, storyboardId, hash: storyboardContentHash(plan) };
}

const approve = async (projectId: string, body: unknown, key = randomUUID()) =>
  json(await routes.approvals.POST(h.request("POST", `/api/projects/${projectId}/approvals`, { body, key }), params(projectId)));

test("converting the working storyboard to the model format and back reproduces it exactly", () => {
  const roundTrip = compilePlan(toModelPlan(plan), { topic: "", audience: plan.audience, notes: "", voicePreset: plan.voicePreset }) as PlanV2;
  assert.deepEqual(roundTrip.scenes, plan.scenes);
  assert.deepEqual(validatePlanV2(roundTrip).issues, []);
});

test("scene-scoped revisions keep every other scene identical even if the model changes them", async () => {
  const model = toModelPlan(plan);
  const target = plan.scenes[1].id;
  const output = {
    ...model,
    changeSummary: "Made the second scene simpler.",
    scenes: model.scenes.map((s, i) => ({ ...s, narration: i === 1 ? `${s.narration} Think of it like a contact list on your phone.` : "The model rewrote this unrelated scene by mistake, which must be ignored." })),
  };
  const fetchImpl = (async () => new Response(JSON.stringify({ status: "completed", steps: [{ type: "model_output", content: [{ type: "text", text: JSON.stringify(output) }] }] }))) as unknown as typeof fetch;
  const revised = await reviseStoryboard({ apiKey: "k", model: "m" }, { plan, instruction: "Make it simpler", sceneId: target, topic: "How DNS works", audience: "", notes: "", voicePreset: plan.voicePreset }, { fetchImpl });
  assert.deepEqual(changedScenes(plan, revised.plan), [target]);
  assert.equal(revised.changeSummary, "Made the second scene simpler.");
  plan.scenes.forEach((scene, i) => { if (i !== 1) assert.deepEqual(revised.plan.scenes[i], scene); });
});

test("revision acceptance resolves against the exact source version and an existing scene", async () => {
  const { projectId, storyboardId, hash } = await appliedProject();
  const body = (extra: Record<string, unknown> = {}) => ({ source: { kind: "storyboard" as const, id: storyboardId, hash }, expectedDraftRevision: 3, instruction: "Make the opening simpler", ...extra });
  const accept = (b: ReturnType<typeof body>) => acceptRevision(h.services, identity("a", `/api/projects/${projectId}/revisions`, b), projectId, b);

  await assert.rejects(accept(body({ source: { kind: "storyboard", id: storyboardId, hash: "0".repeat(64) } })), (e: { code?: string }) => e.code === "SOURCE_CHANGED");
  await assert.rejects(accept(body({ sceneId: "no-such-scene" })), (e: { code?: string }) => e.code === "INVALID_SCENE");
  await assert.rejects(accept(body({ source: { kind: "video", id: storyboardId, hash } })), (e: { status?: number }) => e.status === 422);
  await assert.rejects(accept(body({ expectedDraftRevision: 2 })), (e: { code?: string }) => e.code === "REVISION_CONFLICT");
  const ok = await accept(body({ sceneId: plan.scenes[0].id }));
  const job = await h.db.collection("jobs").findOne({ _id: ok.jobId as never });
  assert.deepEqual([job?.type, job?.inputSnapshot.sceneId, job?.inputSnapshot.plan.scenes.length], ["revision", plan.scenes[0].id, plan.scenes.length]);
});

test("a revision saves a candidate with parent, summary and changed scenes, without touching the working draft", async () => {
  const { projectId, storyboardId, hash } = await appliedProject();
  const b = { source: { kind: "storyboard" as const, id: storyboardId, hash }, expectedDraftRevision: 3, instruction: "Simplify scene two" };
  const { jobId } = await acceptRevision(h.services, identity("a", `/api/projects/${projectId}/revisions`, b), projectId, b);
  const revisedPlan = structuredClone(plan);
  revisedPlan.scenes[1].narration += " It works like the contacts list on your phone.";
  await runRevision(h.services, jobId, async () => ({ plan: revisedPlan, warnings: [], attempts: 1, changeSummary: "Added a phone contacts analogy." }), "test");

  const result = (await getJob(h.db, h.users.a.id, jobId))?.result as { storyboardId: string; requiresApply: boolean };
  const candidate = (await json(await routes.one.GET(h.request("GET", `/api/storyboards/${result.storyboardId}`), params(result.storyboardId)))).body.data;
  assert.deepEqual([candidate.parentId, candidate.changeSummary, candidate.changedSceneIds, candidate.state, result.requiresApply], [storyboardId, "Added a phone contacts analogy.", [plan.scenes[1].id], "review_ready", true]);
  const draft = await getDraft(projectId);
  assert.deepEqual([draft.revision, draft.sourceStoryboardId], [3, storyboardId]);
  assert.deepEqual(draft.editablePlan, plan);
  const message = await h.db.collection("messages").findOne({ operationId: jobId, role: "assistant" });
  assert.match(message?.text, /phone contacts analogy.*Changed scenes/);
});

test("approval locks the exact reviewed storyboard; replays and repeated approvals are idempotent", async () => {
  const { projectId, storyboardId } = await appliedProject();
  const draft = await getDraft(projectId);
  const key = randomUUID();
  const approved = await approve(projectId, { expectedDraftRevision: draft.revision, expectedContentHash: draft.contentHash, approve: true }, key);
  assert.equal(approved.status, 201);
  const { approval, storyboard } = approved.body.data;
  assert.deepEqual([approval.kind, approval.subjectId, storyboard.state, storyboard.approvalId], ["story", storyboardId, "approved", approval.id]);
  assert.equal(approval.subjectHash, storyboard.storyHash);

  const replay = await approve(projectId, { expectedDraftRevision: draft.revision, expectedContentHash: draft.contentHash, approve: true }, key);
  assert.deepEqual([replay.status, replay.headers.get("idempotency-replayed"), replay.body.data.approval.id], [201, "true", approval.id]);
  const after = await getDraft(projectId);
  const again = await approve(projectId, { expectedDraftRevision: after.revision, expectedContentHash: after.contentHash, approve: true });
  assert.equal(again.body.data.approval.id, approval.id, "approving identical content again returns the same approval");
  assert.equal(await h.db.collection("approvals").countDocuments({ projectId }), 1);
});

test("edited storyboards are snapshotted immutably on approval, and later edits never change the approved version", async () => {
  const { projectId, storyboardId } = await appliedProject();
  const edited = structuredClone(plan);
  edited.scenes[0].title = "The Internet’s Phonebook";
  const saved = await json(await routes.draft.PATCH(h.request("PATCH", `/api/projects/${projectId}/draft`, { body: { expectedRevision: 3, changes: { editablePlan: edited } } }), params(projectId)));
  const approved = await approve(projectId, { expectedDraftRevision: saved.body.data.revision, expectedContentHash: saved.body.data.contentHash, approve: true });
  const snapshot = approved.body.data.storyboard;
  assert.notEqual(snapshot.id, storyboardId);
  assert.deepEqual([snapshot.parentId, snapshot.changeSummary, snapshot.changedSceneIds, snapshot.state], [storyboardId, "Edited during review.", [plan.scenes[0].id], "approved"]);
  assert.equal((await getDraft(projectId)).sourceStoryboardId, snapshot.id);
  assert.equal((await h.db.collection("storyboards").findOne({ _id: storyboardId as never }))?.state, "review_ready", "the unedited candidate is not approved");

  const draft = await getDraft(projectId);
  const later = structuredClone(edited);
  later.scenes[0].title = "Changed after approval";
  await routes.draft.PATCH(h.request("PATCH", `/api/projects/${projectId}/draft`, { body: { expectedRevision: draft.revision, changes: { editablePlan: later } } }), params(projectId));
  const stored = await h.db.collection("storyboards").findOne({ _id: snapshot.id as never });
  assert.equal(stored?.content.scenes[0].title, "The Internet’s Phonebook");
  assert.equal(stored?.contentHash, storyboardContentHash(edited));
});

test("approval rejects changed, stale, invalid, mis-sized and missing storyboards", async () => {
  const { projectId } = await appliedProject();
  const draft = await getDraft(projectId);
  const body = (extra: Record<string, unknown> = {}) => ({ expectedDraftRevision: draft.revision, expectedContentHash: draft.contentHash, approve: true, ...extra });
  assert.equal((await approve(projectId, body({ expectedContentHash: "0".repeat(64) }))).body.error.code, "HASH_MISMATCH");
  assert.equal((await approve(projectId, body({ expectedDraftRevision: 1 }))).body.error.code, "REVISION_CONFLICT");
  assert.equal((await approve(projectId, body({ approve: false }))).status, 422);

  const broken = structuredClone(plan);
  broken.scenes[0].narration = "A rewritten narration that no longer contains the visual cue words at all.";
  const savedBroken = (await json(await routes.draft.PATCH(h.request("PATCH", `/api/projects/${projectId}/draft`, { body: { expectedRevision: draft.revision, changes: { editablePlan: broken } } }), params(projectId)))).body.data;
  const invalid = await approve(projectId, { expectedDraftRevision: savedBroken.revision, expectedContentHash: savedBroken.contentHash, approve: true });
  assert.equal(invalid.body.error.code, "INVALID_DRAFT");
  assert.ok(invalid.body.error.fieldErrors.some((e: { code: string }) => e.code === "CUE_NOT_FOUND"));

  const short = structuredClone(plan);
  short.scenes = short.scenes.slice(0, 3);
  const savedShort = (await json(await routes.draft.PATCH(h.request("PATCH", `/api/projects/${projectId}/draft`, { body: { expectedRevision: savedBroken.revision, changes: { editablePlan: short } } }), params(projectId)))).body.data;
  assert.equal((await approve(projectId, { expectedDraftRevision: savedShort.revision, expectedContentHash: savedShort.contentHash, approve: true })).body.error.code, "INVALID_DRAFT");

  const stale = (await json(await routes.draft.PATCH(h.request("PATCH", `/api/projects/${projectId}/draft`, { body: { expectedRevision: savedShort.revision, changes: { editablePlan: plan, topic: "Something else" } } }), params(projectId)))).body.data;
  assert.equal(stale.planStale, true);
  assert.match((await approve(projectId, { expectedDraftRevision: stale.revision, expectedContentHash: stale.contentHash, approve: true })).body.error.message, /idea changed/);

  const empty = (await json(await routes.projects.POST(h.request("POST", "/api/projects", { body: {}, key: randomUUID() })))).body.data;
  const emptyDraft = await getDraft(empty.id);
  assert.equal((await approve(empty.id, { expectedDraftRevision: emptyDraft.revision, expectedContentHash: emptyDraft.contentHash, approve: true })).body.error.code, "INVALID_DRAFT");
  assert.equal((await json(await routes.approvals.POST(h.request("POST", `/api/projects/${projectId}/approvals`, { user: "b", body: body(), key: randomUUID() }), params(projectId)))).status, 404);
});

test("restore makes an earlier version the working copy and keeps later versions", async () => {
  const { projectId, storyboardId, hash } = await appliedProject();
  const b = { source: { kind: "storyboard" as const, id: storyboardId, hash }, expectedDraftRevision: 3, instruction: "Change scene one" };
  const { jobId } = await acceptRevision(h.services, identity("a", `/api/projects/${projectId}/revisions`, b), projectId, b);
  const revisedPlan = structuredClone(plan);
  revisedPlan.scenes[0].kicker = "Revised kicker";
  await runRevision(h.services, jobId, async () => ({ plan: revisedPlan, warnings: [], attempts: 1, changeSummary: "Changed the kicker." }), "test");
  const revisedId = ((await getJob(h.db, h.users.a.id, jobId))?.result as { storyboardId: string }).storyboardId;
  await routes.apply.POST(h.request("POST", `/api/projects/${projectId}/draft/apply`, { key: randomUUID(), body: { expectedDraftRevision: 3, storyboardId: revisedId, expectedContentHash: storyboardContentHash(revisedPlan) } }), params(projectId));
  assert.equal((await getDraft(projectId)).editablePlan.scenes[0].kicker, "Revised kicker");

  const restored = await json(await routes.restore.POST(h.request("POST", `/api/projects/${projectId}/draft/restore`, { key: randomUUID(), body: { expectedDraftRevision: 4, storyboardId, expectedContentHash: hash } }), params(projectId)));
  assert.equal(restored.status, 200);
  assert.deepEqual([restored.body.data.sourceStoryboardId, restored.body.data.editablePlan.scenes[0].kicker], [storyboardId, plan.scenes[0].kicker]);
  assert.equal(await h.db.collection("storyboards").countDocuments({ projectId }), 2, "later versions stay in history");
});
