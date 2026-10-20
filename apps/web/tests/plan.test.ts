// PlanV2 contract and component registry: structural and semantic validation.
import { test } from "node:test";
import assert from "node:assert/strict";
import realPlan from "./fixtures/plan-dns.json";
import { binaryTrace as prototypeTrace } from "../../../src/pipeline/search";
import { binaryTrace, cueIndex, estimateSeconds, validatePlanV2, type PlanV2 } from "../lib/plan";

const clone = (): PlanV2 => structuredClone(realPlan) as PlanV2;
const codes = (input: unknown, options?: Parameters<typeof validatePlanV2>[1]) => validatePlanV2(input, options).issues.map((i) => i.code);

function searchScene(id: string, step: number, mode: "setup" | "compare" | "result", narration: string, events: PlanV2["scenes"][number]["events"]) {
  return {
    id, title: "Binary search", kicker: "Step", narration, pronunciation: [], sourceIds: [], events,
    visual: { component: "binary-search" as const, version: 1 as const, data: { values: [3, 8, 12, 20, 31, 44, 57], target: 44, step, mode } },
  };
}
const ev = (id: string, targetId: string, action: string, phrase: string) => ({ id, targetId, action, cue: { phrase, occurrence: 1, offsetMs: 0 }, durationMs: 600 });
function searchPlan(): PlanV2 {
  // Trace for 44 in [3,8,12,20,31,44,57]: mid 3 (20 < 44 → right), mid 5 (44 found).
  return {
    schemaVersion: 2, title: "Binary search", audience: "", learningObjective: "Halving a sorted list", language: "en", voicePreset: "daniel-test", sources: [],
    scenes: [
      searchScene("setup", 0, "setup", "Here is a sorted list of seven numbers and we want forty four.", [ev("e1", "range", "reveal", "sorted list")]),
      searchScene("first-check", 0, "compare", "We check the middle value twenty, which is too small, so the left half goes away.", [ev("e1", "midpoint", "reveal", "middle value"), ev("e2", "range", "eliminate", "left half goes away")]),
      searchScene("found", 1, "result", "The next middle value is forty four, and we found it in two checks.", [ev("e1", "range", "found", "we found it")]),
    ],
  };
}

test("a real Gemini-produced plan passes the full contract", () => {
  const { plan, issues, warnings } = validatePlanV2(realPlan);
  assert.deepEqual(issues, []);
  assert.ok(plan);
  assert.deepEqual(warnings, []);
  assert.ok(estimateSeconds(plan) > 60 && estimateSeconds(plan) < 90);
});

test("structural bounds and unknown fields are rejected", () => {
  const p = clone();
  p.scenes = p.scenes.slice(0, 2);
  assert.ok(codes(p).length > 0, "fewer than 3 scenes");
  assert.ok(codes({ ...clone(), extra: true }).length > 0);
  const longTitle = clone();
  longTitle.scenes[0].title = "x".repeat(66);
  assert.ok(codes(longTitle).length > 0);
  const badId = clone();
  badId.scenes[0].id = "Not A Slug";
  assert.ok(codes(badId).length > 0);
});

test("semantic rules: unique IDs, cues, pronunciation, targets, actions and sources", () => {
  const dup = clone();
  dup.scenes[1].id = dup.scenes[0].id;
  assert.ok(codes(dup).includes("DUPLICATE_ID"));
  const cue = clone();
  cue.scenes[0].events[0].cue.phrase = "words that are not there";
  assert.ok(codes(cue).includes("CUE_NOT_FOUND"));
  const occurrence = clone();
  occurrence.scenes[0].events[0].cue.occurrence = 5;
  assert.ok(codes(occurrence).includes("CUE_NOT_FOUND"));
  const pron = clone();
  pron.scenes[0].pronunciation = [{ phrase: "SQL", occurrence: 1, spokenAs: "sequel" }];
  assert.ok(codes(pron).includes("PHRASE_NOT_FOUND"));
  const target = clone();
  target.scenes[1].events[0].targetId = "middle";
  assert.ok(codes(target).includes("UNKNOWN_TARGET"));
  const action = clone();
  action.scenes[1].events[0].action = "explode";
  assert.ok(codes(action).includes("UNKNOWN_ACTION"));
  const source = clone();
  source.scenes[0].sourceIds = ["missing"];
  assert.ok(codes(source).includes("UNKNOWN_SOURCE"));
});

test("component data: flow edges, comparison limits, disabled and topic-disallowed components", () => {
  const flow = clone();
  const data = flow.scenes[0].visual.data as { edges: { from: string; to: string }[] };
  data.edges[0].to = "nowhere";
  assert.ok(codes(flow).includes("INVALID_EDGE"));
  const comparison = clone();
  (comparison.scenes[1].visual.data as { left: { heading: string } }).left.heading = "A heading that is far too long";
  assert.ok(codes(comparison).includes("INVALID_DATA"));
  const disabled = clone();
  (disabled.scenes[0].visual as { component: string }).component = "chart";
  assert.ok(codes(disabled).length > 0, "chart is not enabled yet");
  assert.ok(codes(clone(), { allowedComponents: ["flow"] }).includes("UNSUPPORTED_VISUAL"));
});

test("binary search: valid trace passes; wrong steps, missing or early decisions and changed examples fail", () => {
  assert.deepEqual(validatePlanV2(searchPlan()).issues, []);
  const setup = searchPlan();
  (setup.scenes[0].visual.data as { step: number }).step = 1;
  assert.ok(codes(setup).includes("INVALID_STEP"));
  const result = searchPlan();
  (result.scenes[2].visual.data as { step: number }).step = 0;
  assert.ok(codes(result).includes("INVALID_STEP"));
  const missing = searchPlan();
  missing.scenes[1].events = [missing.scenes[1].events[0]];
  assert.ok(codes(missing).includes("MISSING_DECISION"));
  const wrongDecision = searchPlan();
  wrongDecision.scenes[1].events[1].action = "found"; // 20 is not the target
  assert.ok(codes(wrongDecision).includes("MISSING_DECISION"));
  const early = searchPlan();
  early.scenes[1].narration = "The left half goes away because the middle value twenty is too small for us.";
  assert.ok(codes(early).includes("DECISION_BEFORE_MIDPOINT"));
  const changed = searchPlan();
  (changed.scenes[2].visual.data as { target: number }).target = 57;
  assert.ok(codes(changed).includes("INCONSISTENT_EXAMPLE"));
  const unsorted = searchPlan();
  (unsorted.scenes[0].visual.data as { values: number[] }).values = [8, 3, 12];
  assert.ok(codes(unsorted).includes("NOT_SORTED"));
});

test("the binary search trace matches the prototype renderer exactly", () => {
  for (let n = 0; n < 300; n++) {
    const size = 3 + (n % 7);
    const values = [...new Set(Array.from({ length: size * 2 }, (_, i) => (i * 7 + n * 13) % 100))].sort((a, b) => a - b).slice(0, size);
    if (values.length < 3) continue;
    const target = n % 2 ? values[n % values.length] : (n * 31) % 100;
    assert.deepEqual(
      binaryTrace(values, target).map(({ low, high, mid, outcome }) => ({ low, high, mid, outcome })),
      prototypeTrace(values, target).map(({ low, high, mid, outcome }) => ({ low, high, mid, outcome })),
    );
  }
});

test("duration estimate warns outside the 60-90 second guidance and cue lookup respects occurrences", () => {
  const short = clone();
  short.scenes = short.scenes.slice(0, 3).map((s) => ({ ...s }));
  const { warnings } = validatePlanV2(short);
  assert.equal(warnings[0]?.code, "DURATION_ESTIMATE");
  assert.equal(cueIndex("rain then rain", "rain", 2), 10);
  assert.equal(cueIndex("rain", "rain", 2), -1);
});
