// Voice catalog, P10 voices API and catalog samples served through short-lived grants (in-memory object store).
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { MemoryObjectStore, setObjectStoreForTests } from "../server/media/object-store";
import { generateSample } from "../server/media/voice-samples";
import { availableVoices, isVoiceAvailable, providerVoiceId } from "../server/voices";
import { json, startHarness, ORIGIN, type Harness } from "./harness";

let h: Harness;
const store = new MemoryObjectStore();
let routes: { voices: typeof import("../app/api/voices/route"); sample: typeof import("../app/api/voices/[preset]/sample/route"); media: typeof import("../app/api/media/[token]/route") };

before(async () => {
  setObjectStoreForTests(store);
  h = await startHarness("voices", ["a"]);
  routes = { voices: await import("../app/api/voices/route"), sample: await import("../app/api/voices/[preset]/sample/route"), media: await import("../app/api/media/[token]/route") };
});
after(async () => {
  setObjectStoreForTests(undefined);
  await h?.stop();
});

const MP3 = Buffer.concat([Buffer.from("ID3"), Buffer.alloc(2000, 1)]);
const audioFetch = (body: Buffer | string) => {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(typeof body === "string" ? body : new Uint8Array(body), { status: 200 });
  }) as unknown as typeof fetch;
  return { impl, calls };
};
const sampleRequest = (preset: string, signedIn = true) =>
  routes.sample.GET(signedIn ? h.request("GET", `/api/voices/${preset}/sample`) : new Request(`${ORIGIN}/api/voices/${preset}/sample`), { params: Promise.resolve({ preset }) });

test("the catalog exposes only configured voices and keeps provider IDs server-side", () => {
  assert.deepEqual(availableVoices({}).map((v) => v.preset), ["daniel-test"]);
  assert.ok(!JSON.stringify(availableVoices({})).includes("onwK4e9ZLuTAKqWW03F9"));
  assert.equal(isVoiceAvailable("indian-english-male", {}), false);
  assert.equal(providerVoiceId("indian-english-male", { ELEVENLABS_VOICE_ID_INDIAN_MALE: "voice123" }), "voice123");
  assert.equal(providerVoiceId("daniel-test", {}), "onwK4e9ZLuTAKqWW03F9");
});

test("generating a sample calls ElevenLabs once, validates MP3 and stores it in the private catalog", async () => {
  const { impl, calls } = audioFetch(MP3);
  await assert.rejects(generateSample(h.db, store, "daniel-test", {}, impl), /ELEVENLABS_API_KEY/);
  const result = await generateSample(h.db, store, "daniel-test", { ELEVENLABS_API_KEY: "test-key" }, impl);
  assert.equal(result.bytes, MP3.length);
  assert.match(calls[0].url, /text-to-speech\/onwK4e9ZLuTAKqWW03F9\?output_format=mp3_44100_128$/);
  assert.equal((calls[0].init.headers as Record<string, string>)["xi-api-key"], "test-key");
  assert.match(result.objectKey, /^catalog\/voice-samples\/daniel-test\/[a-f0-9]{64}\.mp3$/);
  assert.ok(store.objects.has(result.objectKey));
  const record = await h.db.collection("voiceSamples").findOne({ preset: "daniel-test", enabled: true });
  assert.deepEqual([record?.sha256, Number(record?.bytes)], [result.sha256, MP3.length]);

  await assert.rejects(generateSample(h.db, store, "daniel-test", { ELEVENLABS_API_KEY: "k" }, audioFetch("<html>".padEnd(2000, " ")).impl), /did not return MP3/);
  await assert.rejects(generateSample(h.db, store, "indian-english-male", { ELEVENLABS_API_KEY: "k" }, impl), /not available/);
  // A new configuration replaces the old sample: exactly one enabled sample per preset.
  await generateSample(h.db, store, "daniel-test", { ELEVENLABS_API_KEY: "k", ELEVENLABS_MODEL: "another-model" }, audioFetch(Buffer.concat([MP3, Buffer.from("x")])).impl);
  assert.equal(await h.db.collection("voiceSamples").countDocuments({ preset: "daniel-test", enabled: true }), 1);
});

test("the sample route requires a session and redirects to a short-lived gateway URL that serves the audio", async () => {
  assert.equal((await sampleRequest("daniel-test", false)).status, 401);
  const redirect = await sampleRequest("daniel-test");
  assert.equal(redirect.status, 302);
  const location = redirect.headers.get("location") ?? "";
  assert.match(location, /^\/api\/media\/[A-Za-z0-9_-]{43}$/);
  const token = location.split("/").pop()!;
  const audio = await routes.media.GET(new Request(`${ORIGIN}${location}`), { params: Promise.resolve({ token }) });
  assert.deepEqual([audio.status, audio.headers.get("content-type")], [200, "audio/mpeg"]);
  assert.ok((await audio.arrayBuffer()).byteLength > MP3.length - 1);
  const grant = await h.db.collection("mediaGrants").findOne({ purpose: "voice_sample" });
  assert.equal(grant?.projectId, undefined);
  assert.ok(!JSON.stringify(grant).includes(token), "only the token hash is stored");

  assert.equal((await sampleRequest("indian-english-male")).status, 404);
  const voices = (await json(await routes.voices.GET(h.request("GET", "/api/voices")))).body.data;
  assert.deepEqual(voices.voices.map((v: { preset: string; sampleUrl: string | null }) => [v.preset, v.sampleUrl]), [["daniel-test", "/api/voices/daniel-test/sample"]]);
});
