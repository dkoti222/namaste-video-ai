// F09 storyboard generation backend: acceptance rules, saved immutable candidates, hashes, failure recovery,
// list/get APIs and isolation. The planner is replaced by a fake returning a real Gemini-produced plan.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import realPlan from "./fixtures/plan-dns.json";
import { ProviderError } from "../server/ai/gemini";
import { commandIdentity } from "../server/commands";
import { getJob } from "../server/projects/service";
import { acceptStoryboard, runStoryboard, storyHash, storyboardContentHash } from "../server/storyboards/service";
import type { PlanV2 } from "../lib/plan";
import { json, params, startHarness, type Harness } from "./harness";

let h: Harness;
let routes: {
  projects: typeof import("../app/api/projects/route");
  project: typeof import("../app/api/projects/[id]/route");
  draft: typeof import("../app/api/projects/[id]/draft/route");
  list: typeof import("../app/api/projects/[id]/storyboards/route");
  one: typeof import("../app/api/storyboards/[id]/route");
};
const plan = realPlan as PlanV2;
const planner = async () => ({ plan, warnings: [], attempts: 1 });

before(async () => {
  delete process.env.GEMINI_API_KEY;
  h = await startHarness("f09", ["a", "b"]);
  routes = {
    projects: await import("../app/api/projects/route"),
    project: await import("../app/api/projects/[id]/route"),
    draft: await import("../app/api/projects/[id]/draft/route"),
    list: await import("../app/api/projects/[id]/storyboards/route"),
    one: await import("../app/api/storyboards/[id]/route"),
  };
});
after(() => h?.stop());

async function projectWithTopic(topic = "Explain how DNS works", user = "a") {
  const project = (await json(await routes.projects.POST(h.request("POST", "/api/projects", { user, body: {}, key: randomUUID() })))).body.data;
  if (topic) {
    await routes.draft.PATCH(h.request("PATCH", `/api/projects/${project.id}/draft`, { user, body: { expectedRevision: 1, changes: { topic } } }), params(project.id));
  }
  return project as { id: string };
}
const accept = (projectId: string, revision: number, user = "a") => {
  const body = { expectedDraftRevision: revision };
  const request = new Request(`http://x/api/projects/${projectId}/storyboards`, { method: "POST", headers: { "idempotency-key": randomUUID() } });
  return acceptStoryboard(h.services, commandIdentity(request, h.users[user].id, `/api/projects/${projectId}/storyboards`, body), projectId, body);
};
const listFor = async (projectId: string, user = "a") => json(await routes.list.GET(h.request("GET", `/api/projects/${projectId}/storyboards`, { user }), params(projectId)));
const getOne = async (id: string, user = "a") => json(await routes.one.GET(h.request("GET", `/api/storyboards/${id}`, { user }), params(id)));

test("the route refuses cleanly without Gemini, and a draft without a topic is rejected as INVALID_DRAFT", async () => {
  const p = await projectWithTopic();
  const response = await json(await routes.list.POST(h.request("POST", `/api/projects/${p.id}/storyboards`, { body: { expectedDraftRevision: 2 }, key: randomUUID() }), params(p.id)));
  assert.deepEqual([response.status, response.body.error.code], [503, "INTEGRATION_UNAVAILABLE"]);

  const empty = await projectWithTopic("");
  await assert.rejects(accept(empty.id, 1), (e: { code?: string; options?: { fieldErrors?: { path: string }[] } }) =>
    e.code === "INVALID_DRAFT" && e.options?.fieldErrors?.[0].path === "draft.topic");
  assert.equal((await h.db.collection("projects").findOne({ _id: empty.id as never }))?.activeJobId, undefined, "rejection does not take the slot");
});

test("a run saves an immutable review-ready candidate with hashes and leaves the working draft untouched", async () => {
  const p = await projectWithTopic();
  const { jobId } = await accept(p.id, 2);
  await runStoryboard(h.services, jobId, planner, "gemini-test");

  const job = await getJob(h.db, h.users.a.id, jobId);
  assert.equal(job?.state, "succeeded");
  const result = job?.result as { kind: string; storyboardId: string; requiresApply: boolean };
  assert.deepEqual([result.kind, result.requiresApply], ["storyboard", true]);

  const stored = await h.db.collection("storyboards").findOne({ _id: result.storyboardId as never });
  assert.deepEqual(
    [stored?.state, stored?.sourceDraftRevision, stored?.contentHash, stored?.storyHash, stored?.plannerConfig.model, stored?.createdByJobId],
    ["review_ready", 2, storyboardContentHash(plan), storyHash(plan), "gemini-test", jobId],
  );
  assert.ok(stored?.estimatedDurationSeconds > 60);
  const message = await h.db.collection("messages").findOne({ operationId: jobId, role: "assistant" });
  assert.equal(message?.sourceStoryboardId, result.storyboardId);
  assert.match(message?.text, /Storyboard ready/);

  const draft = await h.db.collection("drafts").findOne({ projectId: p.id });
  assert.deepEqual([draft?.revision, draft?.editablePlan], [2, null], "candidates never overwrite the draft");
  assert.equal((await h.db.collection("projects").findOne({ _id: p.id as never }))?.activeJobId, undefined);
});

test("story hash ignores presentational timing but changes with narration; content hash covers everything", () => {
  const timing = structuredClone(plan);
  timing.scenes[0].events[0].cue.offsetMs = 200;
  timing.scenes[0].events[0].durationMs = 1200;
  assert.equal(storyHash(timing), storyHash(plan));
  assert.notEqual(storyboardContentHash(timing), storyboardContentHash(plan));
  const words = structuredClone(plan);
  words.scenes[0].narration += " Extra words.";
  assert.notEqual(storyHash(words), storyHash(plan));
});

test("a planner failure fails the job recoverably and the next request can run", async () => {
  const p = await projectWithTopic();
  const first = await accept(p.id, 2);
  await runStoryboard(h.services, first.jobId, async () => {
    throw new ProviderError("PROVIDER_REJECTED", true, "The AI couldn’t produce a valid storyboard this time. Try again, or simplify the topic.");
  }, "gemini-test");
  const failed = await getJob(h.db, h.users.a.id, first.jobId);
  assert.deepEqual([failed?.state, failed?.error?.code, failed?.error?.retryable], ["failed", "PROVIDER_REJECTED", true]);
  assert.equal(await h.db.collection("storyboards").countDocuments({ projectId: p.id }), 0);

  const second = await accept(p.id, 2);
  await runStoryboard(h.services, second.jobId, planner, "gemini-test");
  assert.equal(await h.db.collection("storyboards").countDocuments({ projectId: p.id }), 1);
});

test("storyboards are listed newest first, readable by the owner only, and hidden after deletion", async () => {
  const p = await projectWithTopic();
  for (let i = 0; i < 2; i++) {
    const { jobId } = await accept(p.id, 2);
    await runStoryboard(h.services, jobId, planner, "gemini-test");
  }
  const listed = await listFor(p.id);
  assert.equal(listed.status, 200);
  assert.equal(listed.body.data.length, 2);
  const first = listed.body.data[0];
  assert.ok(first.createdAt >= listed.body.data[1].createdAt);
  assert.deepEqual([first.title, first.sceneCount, first.state, first.approvalId, "content" in first], [plan.title, plan.scenes.length, "review_ready", null, false]);

  const full = await getOne(first.id);
  assert.equal(full.status, 200);
  assert.equal(full.body.data.content.scenes.length, plan.scenes.length);
  assert.equal(full.body.data.contentHash, storyboardContentHash(plan));

  assert.equal((await getOne(first.id, "b")).status, 404);
  assert.equal((await listFor(p.id, "b")).status, 404);
  assert.equal((await getOne("stb_doesnotexist0000000")).status, 404);

  await routes.project.DELETE(h.request("DELETE", `/api/projects/${p.id}`, { body: { expectedRevision: 1, confirm: true }, key: randomUUID() }), params(p.id));
  assert.equal((await getOne(first.id)).status, 404);
  assert.equal((await listFor(p.id)).status, 404);
});
