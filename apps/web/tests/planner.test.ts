// Storyboard planner with a fake Gemini: deterministic compilation, topic-limited components and bounded repair.
import { test } from "node:test";
import assert from "node:assert/strict";
import { compilePlan, componentsForTopic, generateStoryboard, PlannerError, searchTraceHint } from "../server/ai/planner";
import { validatePlanV2, type PlanV2 } from "../lib/plan";

const config = { apiKey: "test-key", model: "gemini-3.5-flash-lite" };
const input = { topic: "Explain how DNS works", audience: "School students", notes: "DNS maps names to IP addresses.", voicePreset: "daniel-test" };

const scene = (id: string, component: string, extra: Record<string, unknown> = {}) => ({
  id,
  title: `Scene ${id}`,
  kicker: "Kicker",
  narration: `This scene called ${id} explains one clear idea about the domain name system for beginners today.`,
  component,
  cue: `scene called ${id}`,
  ...extra,
});
const flow = (id: string) => scene(id, "flow", { labels: ["Browser", "Resolver", "Server"] });
const modelOutput = (scenes: unknown[]) => ({ title: "How DNS works", learningObjective: "Understand DNS lookups", scenes }) as Parameters<typeof compilePlan>[0];
const goodOutput = modelOutput([flow("intro"), scene("compare", "comparison", { comparison: { left: { heading: "Names", points: ["Easy to read"] }, right: { heading: "Numbers", points: ["Used by routers"] } } }), flow("lookup"), flow("answer")]);

function fakeGemini(outputs: unknown[]) {
  const bodies: Record<string, unknown>[] = [];
  const impl = (async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)));
    const next = outputs.shift();
    const text = typeof next === "string" ? next : JSON.stringify(next);
    return new Response(JSON.stringify({ status: "completed", steps: [{ type: "model_output", content: [{ type: "text", text }] }] }), { status: 200 });
  }) as unknown as typeof fetch;
  return { impl, bodies };
}

test("components follow the topic like the prototype renderer", () => {
  assert.deepEqual(componentsForTopic("Explain binary search"), ["binary-search", "flow"]);
  assert.ok(componentsForTopic("The water cycle").includes("evaporation"));
  assert.deepEqual(componentsForTopic("How DNS works"), ["flow", "comparison"]);
});

test("compilation produces a valid PlanV2 with generated flow edges, events and note sources", () => {
  const plan = compilePlan(goodOutput, input) as PlanV2;
  const { issues } = validatePlanV2(plan);
  assert.deepEqual(issues, []);
  assert.deepEqual(plan.sources, [{ id: "notes", kind: "provided_notes", text: input.notes }]);
  const data = plan.scenes[0].visual.data as { steps: { id: string }[]; edges: { from: string; to: string }[] };
  assert.deepEqual(data.edges.map((e) => [e.from, e.to]), [["step-1", "step-2"], ["step-2", "step-3"]]);
  assert.deepEqual(plan.scenes[1].events[0], { id: "e1", targetId: "right", action: "compare", cue: { phrase: "scene called compare", occurrence: 1, offsetMs: 0 }, durationMs: 600 });
});

test("binary-search decisions are computed from the real trace, not trusted from the model", () => {
  const values = [3, 8, 12, 20, 31, 44, 57];
  const narration = "We check the middle value twenty, which is too small, so the left half goes away.";
  const plan = compilePlan(
    modelOutput([
      { ...scene("setup", "binary-search"), search: { values, target: 44, step: 0, mode: "setup" } },
      { ...scene("check", "binary-search"), narration, cue: "middle value", decisionCue: "left half goes away", search: { values, target: 44, step: 0, mode: "compare" } },
      { ...scene("found", "binary-search"), search: { values, target: 44, step: 1, mode: "result" } },
    ]),
    { ...input, topic: "binary search" },
  ) as PlanV2;
  assert.deepEqual(plan.scenes[1].events.map((e) => [e.targetId, e.action]), [["midpoint", "reveal"], ["range", "eliminate"]]);
  assert.deepEqual(plan.scenes[2].events.map((e) => [e.targetId, e.action]), [["range", "found"]]);
});

test("search steps come from scene order, fixing the off-by-one numbering seen from real Gemini output", () => {
  const values = [12, 25, 38, 42, 55, 78, 90];
  // Real Gemini output numbered the checks 1 and 2 (and the result 2) for target 78; the trace has steps 0 and 1.
  const plan = compilePlan(
    modelOutput([
      { ...scene("setup", "binary-search"), search: { values, target: 78, step: 0, mode: "setup" } },
      { ...scene("first", "binary-search"), narration: "The middle value is forty-two, and seventy-eight is greater than forty-two.", cue: "middle value", decisionCue: "greater than forty-two", search: { values, target: 78, step: 1, mode: "compare" } },
      { ...scene("second", "binary-search"), narration: "The new middle value is seventy-eight, which matches our target exactly.", cue: "new middle value", decisionCue: "matches our target", search: { values, target: 78, step: 2, mode: "compare" } },
      { ...scene("done", "binary-search"), search: { values, target: 78, step: 2, mode: "result" } },
    ]),
    { ...input, topic: "binary search" },
  ) as PlanV2;
  assert.deepEqual(plan.scenes.map((s) => (s.visual.data as { step: number }).step), [0, 0, 1, 1]);
  assert.deepEqual(plan.scenes[2].events.map((e) => e.action), ["reveal", "found"]);
  assert.deepEqual(validatePlanV2(plan).issues, []);
});

test("failed search scenes get the real trace in the repair request", () => {
  const model = modelOutput([{ ...scene("s", "binary-search"), search: { values: [10, 23, 35, 42, 58, 71, 89], target: 42, step: 0, mode: "setup" } }]);
  const [hint] = searchTraceHint(model, [{ path: "scenes.1.visual.data.step", code: "INVALID_STEP", message: "x" }]);
  assert.equal(hint.code, "SEARCH_TRACE");
  assert.match(hint.message, /check 1: middle value 42 → found the target/);
  assert.match(hint.message, /exactly 1 compare scene/);
  assert.deepEqual(searchTraceHint(model, [{ path: "scenes.0.title", code: "TOO_LONG", message: "x" }]), []);
});

test("an invalid first result is repaired once using the exact issues", async () => {
  const broken = modelOutput([{ ...flow("intro"), cue: "not in the narration" }, flow("b"), flow("c"), flow("d")]);
  const { impl, bodies } = fakeGemini([broken, goodOutput]);
  const result = await generateStoryboard(config, input, { fetchImpl: impl });
  assert.equal(result.attempts, 2);
  assert.equal(bodies.length, 2);
  const repairInput = JSON.parse(String(bodies[1].input));
  assert.ok(repairInput.fixTheseIssues.some((i: { code: string }) => i.code === "CUE_NOT_FOUND"));
  assert.ok(repairInput.previousOutput);
  const schema = bodies[0].response_format as { schema: { properties: { scenes: { items: { properties: { component: { enum: string[] } } } } } } };
  assert.deepEqual(schema.schema.properties.scenes.items.properties.component.enum, ["flow", "comparison"]);
  const scenes = (schema.schema.properties.scenes as unknown as { minItems: number; maxItems: number });
  assert.deepEqual([scenes.minItems, scenes.maxItems], [6, 8]);
});

test("a valid but too-short plan is sized once, and a second short plan is kept with its warning", async () => {
  const short = modelOutput([flow("a"), flow("b"), flow("c")]);
  const long = modelOutput(["a", "b", "c", "d", "e", "f", "g"].map((id) => ({ ...flow(id), narration: `${flow(id).narration} It adds more helpful detail so that the whole video lasts long enough for viewers.` })));
  const sized = fakeGemini([short, long]);
  const result = await generateStoryboard(config, input, { fetchImpl: sized.impl });
  assert.deepEqual([result.attempts, result.warnings], [2, []]);
  assert.ok(JSON.parse(String(sized.bodies[1].input)).fixTheseIssues[0].message.includes("150-200 spoken words"));

  const stillShort = fakeGemini([short, short]);
  const kept = await generateStoryboard(config, input, { fetchImpl: stillShort.impl });
  assert.deepEqual([kept.attempts, kept.warnings[0].code], [2, "DURATION_ESTIMATE"]);
});

test("malformed JSON is repaired, and two invalid results fail recoverably", async () => {
  const repaired = fakeGemini(["not json", goodOutput]);
  assert.equal((await generateStoryboard(config, input, { fetchImpl: repaired.impl })).attempts, 2);

  const failing = fakeGemini([modelOutput([flow("only")]), modelOutput([flow("still-one")])]);
  await assert.rejects(generateStoryboard(config, input, { fetchImpl: failing.impl }), (e: PlannerError) => e.code === "PROVIDER_REJECTED" && e.retryable);
  assert.equal(failing.bodies.length, 2, "exactly one repair attempt");

  const disallowed = fakeGemini([modelOutput([scene("a", "rain", { labels: ["Rain"] }), flow("b"), flow("c")]), modelOutput([scene("a", "rain", { labels: ["Rain"] }), flow("b"), flow("c")])]);
  await assert.rejects(generateStoryboard(config, input, { fetchImpl: disallowed.impl }), PlannerError);
});
