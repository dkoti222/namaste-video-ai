// ElevenLabs error classification: the refusal reason decides the message and whether Retry is offered.
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyRejection, elevenLabsProvider } from "../server/speech/elevenlabs";

const body = (status: string) => ({ detail: { status, message: "provider text that must not be shown" } });

test("refusal reasons map to safe, actionable errors", () => {
  const cases: [number, unknown, string, boolean][] = [
    [401, body("quota_exceeded"), "PROVIDER_QUOTA", true],
    [429, body("too_many_concurrent_requests"), "PROVIDER_TEMPORARY", true],
    [429, null, "PROVIDER_QUOTA", true],
    [503, null, "PROVIDER_TEMPORARY", true],
    [401, body("invalid_api_key"), "PROVIDER_AUTH", false],
    [401, body("missing_permissions"), "PROVIDER_AUTH", false],
    [401, body("detected_unusual_activity"), "PROVIDER_REJECTED", true],
    [401, null, "PROVIDER_AUTH", true],
    [422, body("invalid_text"), "PROVIDER_REJECTED", false],
  ];
  for (const [status, payload, code, retryable] of cases) {
    const error = classifyRejection(status, payload);
    assert.deepEqual([error.code, error.retryable], [code, retryable], `${status} ${JSON.stringify(payload)}`);
    assert.ok(!error.message.includes("provider text"));
  }
});

test("the provider reads the error body", async () => {
  const fake = (async () => new Response(JSON.stringify(body("quota_exceeded")), { status: 401 })) as unknown as typeof fetch;
  await assert.rejects(elevenLabsProvider("key", fake)("Hello", { voiceId: "v", model: "m", stability: 0.5, similarityBoost: 0.75 }), (e: { code?: string }) => e.code === "PROVIDER_QUOTA");
});
