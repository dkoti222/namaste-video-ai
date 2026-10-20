// F08 brainstorm job: acceptance (T03), single content slot, execution claim, completion/failure/cancellation (T04),
// expired-job recovery, owner-only job reads. AI calls are replaced by a fake generator.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ProviderError, type Suggestion } from "../server/ai/gemini";
import { commandIdentity } from "../server/commands";
import { acceptBrainstorm, brainstormBody, latestIdeas, runBrainstorm } from "../server/jobs/brainstorm";
import { getJob } from "../server/projects/service";
import { json, params, startHarness, type Harness } from "./harness";

let h: Harness;
let routes: { projects: typeof import("../app/api/projects/route"); project: typeof import("../app/api/projects/[id]/route"); brainstorm: typeof import("../app/api/projects/[id]/brainstorm/route") };

before(async () => {
  delete process.env.GEMINI_API_KEY;
  h = await startHarness("f08", ["a", "b"]);
  routes = {
    projects: await import("../app/api/projects/route"),
    project: await import("../app/api/projects/[id]/route"),
    brainstorm: await import("../app/api/projects/[id]/brainstorm/route"),
  };
});
after(() => h?.stop());

const IDEAS: Suggestion[] = [
  { topic: "How DNS finds a website", angle: "Follow one lookup step by step", takeaway: "Names become numbers through a chain of servers" },
  { topic: "Why binary search is fast", angle: "Halve the list each time", takeaway: "Sorted data lets you skip most items" },
  { topic: "RAM versus storage", angle: "Desk versus filing cabinet", takeaway: "RAM is fast and temporary" },
];

async function newProject(user = "a") {
  const project = (await json(await routes.projects.POST(h.request("POST", "/api/projects", { user, body: {}, key: randomUUID() })))).body.data;
  return project as { id: string; conversationId: string };
}
function identityFor(projectId: string, body: unknown, user = "a", key: string = randomUUID()) {
  const request = new Request(`http://x/api/projects/${projectId}/brainstorm`, { method: "POST", headers: { "idempotency-key": key } });
  return commandIdentity(request, h.users[user].id, `/api/projects/${projectId}/brainstorm`, body);
}
const accept = (projectId: string, body: { expectedDraftRevision: number; prompt: string }, user = "a", key?: string) =>
  acceptBrainstorm(h.services, identityFor(projectId, body, user, key), projectId, body);
const project = (id: string) => h.db.collection("projects").findOne({ _id: id as never });
const job = (id: string) => h.db.collection("jobs").findOne({ _id: id as never });

test("the route refuses cleanly when Gemini is not configured", async () => {
  const p = await newProject();
  const response = await json(await routes.brainstorm.POST(
    h.request("POST", `/api/projects/${p.id}/brainstorm`, { body: { expectedDraftRevision: 1, prompt: "Ideas" }, key: randomUUID() }),
    params(p.id),
  ));
  assert.deepEqual([response.status, response.body.error.code], [503, "INTEGRATION_UNAVAILABLE"]);
  assert.equal((await project(p.id))?.activeJobId, undefined);
});

test("prompts must contain text and stay within 2,000 code points", () => {
  assert.equal(brainstormBody.safeParse({ expectedDraftRevision: 1, prompt: "   " }).success, false);
  assert.equal(brainstormBody.safeParse({ expectedDraftRevision: 1, prompt: "🎬".repeat(2001) }).success, false);
  assert.equal(brainstormBody.safeParse({ expectedDraftRevision: 1, prompt: "🎬".repeat(2000) }).success, true);
});

test("acceptance commits job, slot, user message, outbox and receipt; replays and busy/stale requests are handled", async () => {
  const p = await newProject();
  const key = randomUUID();
  const body = { expectedDraftRevision: 1, prompt: "Computer science basics" };
  const { jobId, replayed } = await accept(p.id, body, "a", key);
  assert.equal(replayed, false);
  const j = await job(jobId);
  assert.deepEqual([j?.type, j?.state, j?.activeSlot, j?.inputSnapshot.prompt, j?.inputSnapshot.draftRevision], ["brainstorm", "queued", true, body.prompt, 1]);
  assert.equal((await project(p.id))?.activeJobId, jobId);
  const message = await h.db.collection("messages").findOne({ operationId: jobId, messageKey: "request" });
  assert.deepEqual([message?.role, message?.text, Number(message?.sequence), message?.conversationId], ["user", body.prompt, 1, p.conversationId]);
  assert.equal(await h.db.collection("outbox").countDocuments({ aggregateId: jobId, eventType: "job.brainstorm.requested" }), 1);

  assert.deepEqual(await accept(p.id, body, "a", key), { jobId, replayed: true });
  await assert.rejects(accept(p.id, { ...body, prompt: "Another" }), (e: { code?: string; options?: { details?: { activeJobId?: string } } }) => e.code === "PROJECT_BUSY" && e.options?.details?.activeJobId === jobId);

  const other = await newProject();
  await assert.rejects(accept(other.id, { expectedDraftRevision: 7, prompt: "Stale" }), (e: { code?: string }) => e.code === "REVISION_CONFLICT");
  await assert.rejects(accept(p.id, body, "b"), (e: { code?: string }) => e.code === "NOT_FOUND");
});

test("a successful run stores ideas, writes one assistant message, releases the slot and is visible only to the owner", async () => {
  const p = await newProject();
  const { jobId } = await accept(p.id, { expectedDraftRevision: 1, prompt: "Ideas please" });
  let calls = 0;
  const generate = async () => {
    calls++;
    return IDEAS;
  };
  await Promise.all([runBrainstorm(h.services, jobId, generate), runBrainstorm(h.services, jobId, generate)]);
  assert.equal(calls, 1, "the job claim allows exactly one execution");

  const j = await job(jobId);
  assert.equal(j?.state, "succeeded");
  assert.equal(j?.activeSlot, undefined);
  assert.equal(j?.result.suggestions.length, 3);
  assert.ok(j?.result.suggestions.every((s: { id: string }) => /^idea_/.test(s.id)));
  assert.equal((await project(p.id))?.activeJobId, undefined);
  assert.equal(await h.db.collection("messages").countDocuments({ operationId: jobId, role: "assistant" }), 1);

  const view = await getJob(h.db, h.users.a.id, jobId);
  assert.deepEqual([view?.state, view?.result && (view.result as { kind: string }).kind], ["succeeded", "ideas"]);
  assert.equal(await getJob(h.db, h.users.b.id, jobId), null);
  assert.equal((await latestIdeas(h.db, h.users.a.id, p.id))?.suggestions[0].topic, IDEAS[0].topic);

  await runBrainstorm(h.services, jobId, generate);
  assert.equal(calls, 1, "a finished job is never re-run");
  assert.ok(await accept(p.id, { expectedDraftRevision: 1, prompt: "Again" }), "the slot is free for the next request");
});

test("provider failures fail the job safely and release the slot without a result message", async () => {
  const p = await newProject();
  const { jobId } = await accept(p.id, { expectedDraftRevision: 1, prompt: "Ideas" });
  await runBrainstorm(h.services, jobId, async () => {
    throw new ProviderError("PROVIDER_QUOTA", true, "The AI service is rate-limited right now. Try again in a minute.");
  });
  const j = await job(jobId);
  assert.deepEqual([j?.state, j?.error.code, j?.error.retryable], ["failed", "PROVIDER_QUOTA", true]);
  assert.match(j?.error.correlationId, /^cor_/);
  assert.equal((await project(p.id))?.activeJobId, undefined);
  assert.equal(await h.db.collection("messages").countDocuments({ operationId: jobId, role: "assistant" }), 0);
});

test("deleting the project while ideas are generated cancels the job and hides its result", async () => {
  const p = await newProject();
  const { jobId } = await accept(p.id, { expectedDraftRevision: 1, prompt: "Ideas" });
  await runBrainstorm(h.services, jobId, async () => {
    await routes.project.DELETE(
      h.request("DELETE", `/api/projects/${p.id}`, { body: { expectedRevision: 1, confirm: true }, key: randomUUID() }),
      params(p.id),
    );
    return IDEAS;
  });
  const j = await job(jobId);
  assert.deepEqual([j?.state, j?.result, j?.activeSlot], ["cancelled", undefined, undefined]);
  assert.equal(await getJob(h.db, h.users.a.id, jobId), null);
});

test("an expired job no longer blocks the project", async () => {
  const p = await newProject();
  const { jobId } = await accept(p.id, { expectedDraftRevision: 1, prompt: "Ideas" });
  await h.db.collection("jobs").updateOne({ _id: jobId as never }, { $set: { state: "running", deadlineAt: new Date(Date.now() - 1000) } });
  const next = await accept(p.id, { expectedDraftRevision: 1, prompt: "Try again" });
  assert.notEqual(next.jobId, jobId);
  const stale = await job(jobId);
  assert.deepEqual([stale?.state, stale?.error.code], ["failed", "PROVIDER_OUTCOME_UNKNOWN"]);
  assert.equal((await project(p.id))?.activeJobId, next.jobId);
});
