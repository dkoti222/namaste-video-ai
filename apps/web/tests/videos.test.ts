// F15: V01 list, V02 get, V05 exact-version approval, downloads, version independence and isolation.
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
import { videoSubjectHash } from "../server/videos/service";
import type { PlanV2 } from "../lib/plan";
import { json, params, startHarness, ORIGIN, type Harness } from "./harness";

let h: Harness;
const store = new MemoryObjectStore();
let routes: {
  projects: typeof import("../app/api/projects/route");
  project: typeof import("../app/api/projects/[id]/route");
  draft: typeof import("../app/api/projects/[id]/draft/route");
  apply: typeof import("../app/api/projects/[id]/draft/apply/route");
  list: typeof import("../app/api/projects/[id]/videos/route");
  one: typeof import("../app/api/videos/[id]/route");
  approve: typeof import("../app/api/videos/[id]/approve/route");
  access: typeof import("../app/api/assets/[id]/access/route");
  media: typeof import("../app/api/media/[token]/route");
};
const plan = realPlan as PlanV2;
const direct = <T>(_id: string, run: () => Promise<T>) => run();
const speech: SpeechProvider = async (text) => {
  const characters = [...text];
  return { audio: Buffer.concat([Buffer.from("ID3"), Buffer.alloc(1500, 7)]), durationSeconds: characters.length * 0.07, alignment: { characters, character_start_times_seconds: characters.map((_, i) => i * 0.07), character_end_times_seconds: characters.map((_, i) => (i + 1) * 0.07) } };
};
const renderer: Renderer = async (timeline) => ({ video: Buffer.from(`mp4-${timeline.frames}-${randomUUID()}`), durationMs: 10, peakRssBytes: null });
const prober: Prober = async (video) => {
  const seconds = Number(String(video).split("-")[1]) / 30;
  return { format: { duration: String(seconds) }, streams: [{ codec_type: "video", codec_name: "h264", width: 1080, height: 1920, avg_frame_rate: "30/1" }, { codec_type: "audio", codec_name: "aac" }] };
};

before(async () => {
  setObjectStoreForTests(store);
  h = await startHarness("f15", ["a", "b"]);
  routes = {
    projects: await import("../app/api/projects/route"),
    project: await import("../app/api/projects/[id]/route"),
    draft: await import("../app/api/projects/[id]/draft/route"),
    apply: await import("../app/api/projects/[id]/draft/apply/route"),
    list: await import("../app/api/projects/[id]/videos/route"),
    one: await import("../app/api/videos/[id]/route"),
    approve: await import("../app/api/videos/[id]/approve/route"),
    access: await import("../app/api/assets/[id]/access/route"),
    media: await import("../app/api/media/[token]/route"),
  };
});
after(async () => {
  setObjectStoreForTests(undefined);
  await h?.stop();
});

const identity = (path: string, body: unknown, user = "a") =>
  commandIdentity(new Request("http://x", { method: "POST", headers: { "idempotency-key": randomUUID() } }), h.users[user].id, path, body);

async function projectWithReadyVideo(user = "a") {
  const project = (await json(await routes.projects.POST(h.request("POST", "/api/projects", { user, body: {}, key: randomUUID() })))).body.data;
  await routes.draft.PATCH(h.request("PATCH", `/api/projects/${project.id}/draft`, { user, body: { expectedRevision: 1, changes: { topic: "How DNS works" } } }), params(project.id));
  const sb = { expectedDraftRevision: 2 };
  const { jobId } = await acceptStoryboard(h.services, identity(`/api/projects/${project.id}/storyboards`, sb, user), project.id, sb);
  await runStoryboard(h.services, jobId, async () => ({ plan, warnings: [], attempts: 1 }), "test");
  const storyboard = await h.db.collection("storyboards").findOne({ projectId: project.id });
  await routes.apply.POST(h.request("POST", `/api/projects/${project.id}/draft/apply`, { user, key: randomUUID(), body: { expectedDraftRevision: 2, storyboardId: String(storyboard?._id), expectedContentHash: storyboardContentHash(plan) } }), params(project.id));
  const videoId = await generate(project.id, user);
  return { projectId: project.id as string, videoId };
}
async function generate(projectId: string, user = "a") {
  const draft = (await json(await routes.draft.GET(h.request("GET", `/api/projects/${projectId}/draft`, { user }), params(projectId)))).body.data;
  const body = { expectedDraftRevision: draft.revision, expectedContentHash: draft.contentHash, approve: true as const };
  const { operation } = await acceptGeneration(h.services, identity(`/api/projects/${projectId}/generations`, body, user), projectId, body);
  await runGeneration(h.services, operation.jobId, { speech, store, renderer, prober }, direct);
  return operation.resource!.id;
}
const getVideo = async (id: string, user = "a") => json(await routes.one.GET(h.request("GET", `/api/videos/${id}`, { user }), params(id)));
const approve = async (id: string, body: unknown, user = "a", key = randomUUID()) => json(await routes.approve.POST(h.request("POST", `/api/videos/${id}/approve`, { user, body, key }), params(id)));

test("videos are listed newest first with a safe VideoView and no storage details", async () => {
  const { projectId, videoId } = await projectWithReadyVideo();
  const second = await generate(projectId);
  const listed = await json(await routes.list.GET(h.request("GET", `/api/projects/${projectId}/videos`), params(projectId)));
  assert.deepEqual(listed.body.data.map((v: { id: string }) => v.id), [second, videoId]);
  const view = listed.body.data[1];
  assert.deepEqual(
    { state: view.state, width: view.width, height: view.height, fps: view.fps, voice: view.voice.preset, qa: view.qa.passed, approvalId: view.approvalId },
    { state: "ready_for_review", width: 1080, height: 1920, fps: 30, voice: "daniel-test", qa: true, approvalId: null },
  );
  assert.ok(view.durationSeconds > 60 && view.durationSeconds < 90);
  assert.ok(!JSON.stringify(listed.body).match(/objectKey|projects\/prj_|voiceId|tokenHash/), "no storage keys or provider IDs");
  assert.equal((await getVideo(videoId)).body.data.outputHash, view.outputHash);
});

test("final approval covers exactly the reviewed bytes and spec, and is idempotent", async () => {
  const { projectId, videoId } = await projectWithReadyVideo();
  const video = (await getVideo(videoId)).body.data;
  const body = { expectedOutputHash: video.outputHash, expectedRenderSpecHash: video.renderSpecHash, approve: true };
  assert.equal((await approve(videoId, { ...body, expectedOutputHash: "0".repeat(64) })).body.error.code, "HASH_MISMATCH");
  const key = randomUUID();
  const approved = await approve(videoId, body, "a", key);
  assert.equal(approved.status, 200);
  assert.deepEqual([approved.body.data.kind, approved.body.data.subjectId, approved.body.data.subjectHash], ["video", videoId, videoSubjectHash(video.outputHash, video.renderSpecHash)]);
  const after = (await getVideo(videoId)).body.data;
  assert.deepEqual([after.state, after.approvalId], ["approved", approved.body.data.id]);
  assert.equal((await h.db.collection("projects").findOne({ _id: projectId as never }))?.selectedVideoId, videoId);
  assert.equal((await approve(videoId, body, "a", key)).headers.get("idempotency-replayed"), "true");
  assert.equal((await approve(videoId, body)).body.data.id, approved.body.data.id, "approving the same video again returns its approval");
  assert.equal(await h.db.collection("approvals").countDocuments({ subjectId: videoId, kind: "video" }), 1);
});

test("a newer version needs its own approval; downloads work without approval", async () => {
  const { projectId, videoId } = await projectWithReadyVideo();
  const first = (await getVideo(videoId)).body.data;
  await approve(videoId, { expectedOutputHash: first.outputHash, expectedRenderSpecHash: first.renderSpecHash, approve: true });
  const secondId = await generate(projectId);
  const second = (await getVideo(secondId)).body.data;
  assert.deepEqual([second.state, second.approvalId], ["ready_for_review", null]);
  assert.equal((await getVideo(videoId)).body.data.state, "approved", "the approved earlier version is unchanged");

  const grant = await json(await routes.access.POST(h.request("POST", `/api/assets/${second.outputAssetId}/access`, { body: { purpose: "download" } }), params(second.outputAssetId)));
  assert.equal(grant.status, 200);
  const token = grant.body.data.url.split("/").pop();
  const file = await routes.media.GET(new Request(`${ORIGIN}${grant.body.data.url}`), { params: Promise.resolve({ token }) });
  assert.equal(file.status, 200);
  assert.match(file.headers.get("content-disposition") ?? "", /^attachment; filename="namastevideo-video-/);
});

test("unready, foreign and deleted-project videos cannot be read or approved", async () => {
  const { projectId, videoId } = await projectWithReadyVideo();
  const video = (await getVideo(videoId)).body.data;
  const body = { expectedOutputHash: video.outputHash, expectedRenderSpecHash: video.renderSpecHash, approve: true };
  assert.equal((await getVideo(videoId, "b")).status, 404);
  assert.equal((await approve(videoId, body, "b")).status, 404);
  assert.equal((await json(await routes.list.GET(h.request("GET", `/api/projects/${projectId}/videos`, { user: "b" }), params(projectId)))).status, 404);

  await h.db.collection("videos").updateOne({ _id: videoId as never }, { $set: { state: "building" }, $unset: { outputHash: "", outputAssetId: "", qa: "" } });
  assert.equal((await approve(videoId, body)).body.error.code, "VIDEO_NOT_READY");

  const other = await projectWithReadyVideo();
  const project = await h.db.collection("projects").findOne({ _id: other.projectId as never });
  await routes.project.DELETE(h.request("DELETE", `/api/projects/${other.projectId}`, { body: { expectedRevision: project!.revision, confirm: true }, key: randomUUID() }), params(other.projectId));
  assert.equal((await getVideo(other.videoId)).status, 404);
});
