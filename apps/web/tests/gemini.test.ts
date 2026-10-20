// Gemini adapter with a fake fetch: request shape, structured output validation, bounded repair, safe errors.
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateIdeas, interactionText, ProviderError, readGeminiConfig } from "../server/ai/gemini";

const config = { apiKey: "test-key-not-real", model: "gemini-3.5-flash-lite" };
const input = { prompt: "Computer science basics", topic: "", audience: "", notes: "" };
const IDEAS = { suggestions: [1, 2, 3].map((n) => ({ topic: `Topic ${n}`, angle: `Angle ${n}`, takeaway: `Takeaway ${n}` })) };

function interaction(text: string, status = "completed") {
  return { status, steps: [{ type: "thought", signature: "x" }, { type: "model_output", content: [{ type: "text", text }] }] };
}
function fakeFetch(responses: (Response | Error)[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error("unexpected call");
    if (next instanceof Error) throw next;
    return next;
  }) as unknown as typeof fetch;
  return { impl, calls };
}
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

test("configuration requires a key and defaults to the free-tier-friendly model", () => {
  assert.equal(readGeminiConfig({}), null);
  assert.deepEqual(readGeminiConfig({ GEMINI_API_KEY: "k" }), { apiKey: "k", model: "gemini-3.5-flash-lite" });
  assert.equal(readGeminiConfig({ GEMINI_API_KEY: "k", GEMINI_MODEL: "gemini-3.8-flash" })?.model, "gemini-3.8-flash");
});

test("sends a structured-output request and returns validated suggestions", async () => {
  const { impl, calls } = fakeFetch([ok(interaction(JSON.stringify(IDEAS)))]);
  const ideas = await generateIdeas(config, input, { fetchImpl: impl });
  assert.equal(ideas.length, 3);
  const body = JSON.parse(String(calls[0].init.body));
  assert.equal(calls[0].url, "https://generativelanguage.googleapis.com/v1beta/interactions");
  assert.equal((calls[0].init.headers as Record<string, string>)["x-goog-api-key"], config.apiKey);
  assert.deepEqual([body.model, body.store, body.response_format.mime_type], [config.model, false, "application/json"]);
  assert.match(body.system_instruction, /untrusted user data/);
  assert.equal(JSON.parse(body.input).request, input.prompt);
});

test("one malformed response is repaired by a single retry; two fail as rejected", async () => {
  const repaired = fakeFetch([ok(interaction("not json")), ok(interaction(JSON.stringify(IDEAS)))]);
  assert.equal((await generateIdeas(config, input, { fetchImpl: repaired.impl })).length, 3);
  assert.equal(repaired.calls.length, 2);

  const bad = fakeFetch([ok(interaction(JSON.stringify({ suggestions: [] }))), ok(interaction("{}"))]);
  await assert.rejects(generateIdeas(config, input, { fetchImpl: bad.impl }), (e: ProviderError) => e.code === "PROVIDER_REJECTED");
  assert.equal(bad.calls.length, 2);
});

test("HTTP and network failures map to safe categories without leaking the key", async () => {
  const cases: [Response | Error, string, boolean][] = [
    [new Response("{}", { status: 429 }), "PROVIDER_QUOTA", true],
    [new Response("{}", { status: 503 }), "PROVIDER_TEMPORARY", true],
    [new Response("{}", { status: 401 }), "PROVIDER_AUTH", false],
    [new Response("{}", { status: 400 }), "PROVIDER_REJECTED", false],
    [new TypeError("fetch failed"), "PROVIDER_OUTCOME_UNKNOWN", true],
  ];
  for (const [response, code, retryable] of cases) {
    const { impl } = fakeFetch([response]);
    await assert.rejects(generateIdeas(config, input, { fetchImpl: impl }), (e: ProviderError) => {
      assert.ok(!e.message.includes(config.apiKey));
      return e.code === code && e.retryable === retryable;
    });
  }
});

test("only completed model output text is used", () => {
  assert.equal(interactionText(interaction("hello")), "hello");
  assert.throws(() => interactionText(interaction("x", "in_progress")), ProviderError);
  assert.throws(() => interactionText({ status: "completed", steps: [{ type: "thought" }] }), ProviderError);
});
