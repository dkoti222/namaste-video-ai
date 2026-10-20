// F16: caption corrections (V03/V04) — meaning guard, new version with reused speech and inherited story approval,
// preserved previous output, accumulation and rejection paths.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import realPlan from "./fixtures/plan-dns.json";
import { commandIdentity } from "../server/commands";
import { acceptGeneration } from "../server/generation/service";
import { runGeneration } from "../server/generation/runner";
import type { Prober, Renderer } from "../server/generation/render-local";
import { MemoryObjectStore, setObjectStoreForTests } from "../server/media/object-store";
import type { SpeechProvider } from "../server/speech/elevenlabs";
import { acceptStoryboard, runStoryboard, storyboardContentHash } from "../server/storyboards/service";
import { captionEditAllowed } from "../server/videos/captions";
import type { PlanV2 } from "../lib/plan";
import { json, params, startHarness, type Harness } from "./harness";

let h: Harness;
const store = new MemoryObjectStore();
let routes: {
  projects: typeof import("../app/api/projects/route");
  draft: typeof import("../app/api/projects/[id]/draft/route");
  apply: typeof import("../app/api/projects/[id]/draft/apply/route");
  captions: typeof import("../app/api/videos/[id]/captions/route");
  one: typeof import("../app/api/videos/[id]/route");
};
const plan = realPlan as PlanV2;
const direct = <T>(_id: string, run: () => Promise<T>) => run();
let speechCalls = 0;
const speech: SpeechProvider = async (text) => {
  speechCalls++;
  const characters = [...text];
  return { audio: Buffer.concat([Buffer.from("ID3"), Buffer.alloc(1500, 3)]), durationSeconds: characters.length * 0.07, alignment: { characters, character_start_times_seconds: characters.map((_, i) => i * 0.07), character_end_times_seconds: characters.map((_, i) => (i + 1) * 0.07) } };
};
const renderer: Renderer = async (timeline) => ({ video: Buffer.from(`mp4-${timeline.frames}-${randomUUID()}`), durationMs: 5, peakRssBytes: null });
const prober: Prober = async (video) => ({ format: { duration: String(Number(String(video).split("-")[1]) / 30) }, streams: [{ codec_type: "video", codec_name: "h264", width: 1080, height: 1920, avg_frame_rate: "30/1" }, { codec_type: "audio", codec_name: "aac" }] });
const deps = () => ({ speech, store, renderer, prober });

before(async () => {
  setObjectStoreForTests(store);
  h = await startHarness("f16", ["a", "b"]);
  routes = {
    projects: await import("../app/api/projects/route"),
    draft: await import("../app/api/projects/[id]/draft/route"),
    apply: await import("../app/api/projects/[id]/draft/apply/route"),
    captions: await import("../app/api/videos/[id]/captions/route"),
    one: await import("../app/api/videos/[id]/route"),
  };
});
after(async () => {
  setObjectStoreForTests(undefined);
  await h?.stop();
});

const identity = (path: string, body: unknown, user = "a") => commandIdentity(new Request("http://x", { method: "POST", headers: { "idempotency-key": randomUUID() } }), h.users[user].id, path, body);

async function readyVideo(user = "a") {
  const project = (await json(await routes.projects.POST(h.request("POST", "/api/projects", { user, body: {}, key: randomUUID() })))).body.data;
  await routes.draft.PATCH(h.request("PATCH", `/api/projects/${project.id}/draft`, { user, body: { expectedRevision: 1, changes: { topic: "How DNS works" } } }), params(project.id));
  const sb = { expectedDraftRevision: 2 };
  const { jobId } = await acceptStoryboard(h.services, identity(`/api/projects/${project.id}/storyboards`, sb, user), project.id, sb);
  await runStoryboard(h.services, jobId, async () => ({ plan, warnings: [], attempts: 1 }), "test");
  const storyboard = await h.db.collection("storyboards").findOne({ projectId: project.id });
  const applied = (await json(await routes.apply.POST(h.request("POST", `/api/projects/${project.id}/draft/apply`, { user, key: randomUUID(), body: { expectedDraftRevision: 2, storyboardId: String(storyboard?._id), expectedContentHash: storyboardContentHash(plan) } }), params(project.id)))).body.data;
  const body = { expectedDraftRevision: applied.revision, expectedContentHash: applied.contentHash, approve: true as const };
  const { operation } = await acceptGeneration(h.services, identity(`/api/projects/${project.id}/generations`, body, user), project.id, body);
  await runGeneration(h.services, operation.jobId, deps(), direct);
  return { projectId: project.id as string, videoId: operation.resource!.id };
}
const getCaptions = async (videoId: string, user = "a") => json(await routes.captions.GET(h.request("GET", `/api/videos/${videoId}/captions`, { user }), params(videoId)));
const patch = async (videoId: string, body: unknown, user = "a") => json(await routes.captions.PATCH(h.request("PATCH", `/api/videos/${videoId}/captions`, { user, body, key: randomUUID() }), params(videoId)));

test("the meaning guard allows small corrections and refuses rewording and number changes", () => {
  assert.equal(captionEditAllowed("When you type a website name", "When you type a website name."), true);
  assert.equal(captionEditAllowed("your favorite page?", "your favourite page?"), true);
  assert.equal(captionEditAllowed("dns acts like a phonebook", "DNS acts like a phonebook"), true);
  assert.equal(captionEditAllowed("over 300 servers", "over 400 servers"), false);
  assert.equal(captionEditAllowed("computers use numbers", "computers never use numbers at all"), false);
  assert.equal(captionEditAllowed("The resolver asks the root server", "Totally different words in this caption here"), false);
});

test("V03 returns caption lines with code-point source spans, frames and speech fingerprints", async () => {
  const { videoId } = await readyVideo();
  const { status, body } = await getCaptions(videoId);
  assert.equal(status, 200);
  assert.equal(body.data.scenes.length, plan.scenes.length);
  const first = body.data.scenes[0];
  assert.match(first.speechFingerprint, /^[a-f0-9]{64}$/);
  const narration = [...plan.scenes[0].narration];
  for (const line of first.captions) {
    assert.equal(narration.slice(line.sourceStart, line.sourceEnd).join("").split(/\s+/).join(" "), line.text, "span covers exactly the caption words");
    assert.ok(line.endFrame > line.startFrame && line.text.length <= 54);
  }
  assert.equal((await getCaptions(videoId, "b")).status, 404);
});

test("a caption correction creates a new version that reuses speech and story approval and keeps the original", async () => {
  const { projectId, videoId } = await readyVideo();
  const source = (await json(await routes.one.GET(h.request("GET", `/api/videos/${videoId}`), params(videoId)))).body.data;
  const captions = (await getCaptions(videoId)).body.data;
  const line = captions.scenes[0].captions[0];
  const fixed = `${line.text.replace(/[.?!]$/, "")}!`;
  const accepted = await patch(videoId, { expectedRenderSpecHash: captions.renderSpecHash, overrides: [{ sceneId: captions.scenes[0].sceneId, speechFingerprint: captions.scenes[0].speechFingerprint, sourceStart: line.sourceStart, sourceEnd: line.sourceEnd, displayText: fixed }] });
  assert.equal(accepted.status, 202);
  const newVideoId = accepted.body.data.resource.id;
  const newVideo = await h.db.collection("videos").findOne({ _id: newVideoId as never });
  const oldVideo = await h.db.collection("videos").findOne({ _id: videoId as never });
  assert.deepEqual([newVideo?.parentVideoId, newVideo?.storyApprovalId, newVideo?.storyboardId, newVideo?.renderSpec.captionOverrides.length], [videoId, oldVideo?.storyApprovalId, oldVideo?.storyboardId, 1]);
  assert.notEqual(newVideo?.renderSpecHash, source.renderSpecHash);
  const job = await h.db.collection("jobs").findOne({ _id: accepted.body.data.jobId as never });
  assert.equal(job?.type, "caption_render");

  speechCalls = 0;
  assert.equal(await runGeneration(h.services, accepted.body.data.jobId, deps(), direct), "ready");
  assert.equal(speechCalls, 0, "narration is reused; no voice usage for caption fixes");
  const after = (await getCaptions(newVideoId)).body.data;
  assert.equal(after.scenes[0].captions[0].text, fixed);
  assert.deepEqual(after.scenes[1].captions.map((c: { text: string }) => c.text), captions.scenes[1].captions.map((c: { text: string }) => c.text));
  const view = (await json(await routes.one.GET(h.request("GET", `/api/videos/${newVideoId}`), params(newVideoId)))).body.data;
  assert.deepEqual([view.state, view.approvalId], ["ready_for_review", null], "the new version needs its own final approval");
  assert.equal((await getCaptions(videoId)).body.data.scenes[0].captions[0].text, line.text, "the previous version is unchanged");
  assert.equal((await h.db.collection("projects").findOne({ _id: projectId as never }))?.latestReadyVideoId, newVideoId);

  // A second correction on another line keeps the first.
  const second = after.scenes[1].captions[0];
  const again = await patch(newVideoId, { expectedRenderSpecHash: after.renderSpecHash, overrides: [{ sceneId: after.scenes[1].sceneId, speechFingerprint: after.scenes[1].speechFingerprint, sourceStart: second.sourceStart, sourceEnd: second.sourceEnd, displayText: second.text.toUpperCase() }] });
  const third = await h.db.collection("videos").findOne({ _id: again.body.data.resource.id as never });
  assert.equal(third?.renderSpec.captionOverrides.length, 2);
});

test("caption corrections are refused when they change meaning, overflow, or no longer match", async () => {
  const { videoId } = await readyVideo();
  const c = (await getCaptions(videoId)).body.data;
  const scene = c.scenes[0];
  const line = scene.captions[0];
  const base = { sceneId: scene.sceneId, speechFingerprint: scene.speechFingerprint, sourceStart: line.sourceStart, sourceEnd: line.sourceEnd };
  const send = (override: Record<string, unknown>, hash = c.renderSpecHash) => patch(videoId, { expectedRenderSpecHash: hash, overrides: [{ ...base, ...override }] });

  assert.equal((await send({ displayText: "Something with completely different meaning here" })).body.error.code, "CAPTION_MEANING_CHANGE");
  assert.equal((await send({ displayText: "x".repeat(60) })).body.error.code, "INVALID_SPAN");
  assert.equal((await send({ sourceStart: line.sourceStart + 1, displayText: line.text })).body.error.code, "INVALID_SPAN");
  assert.equal((await send({ speechFingerprint: "0".repeat(64), displayText: line.text })).body.error.code, "SOURCE_CHANGED");
  assert.equal((await send({ displayText: line.text }, "0".repeat(64))).body.error.code, "SOURCE_CHANGED");
  assert.equal((await send({ displayText: line.text }, c.renderSpecHash)).status, 202);
  assert.equal((await send({ displayText: `${line.text}.` })).body.error.code, "PROJECT_BUSY", "one content job at a time");
  assert.equal((await patch(videoId, { expectedRenderSpecHash: c.renderSpecHash, overrides: [{ ...base, displayText: line.text }] }, "b")).status, 404);
  await h.db.collection("videos").updateOne({ _id: videoId as never }, { $set: { state: "building" }, $unset: { outputHash: "", outputAssetId: "", qa: "", timelineAssetId: "" } });
  assert.equal((await getCaptions(videoId)).body.error.code, "VIDEO_NOT_READY");
});
