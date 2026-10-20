// Timeline compiler: prototype-compatible output, pronunciation-aware timing and captions, duration gate.
import { test } from "node:test";
import assert from "node:assert/strict";
import realPlan from "./fixtures/plan-dns.json";
import { compileTimeline, CompileError, FPS } from "../server/generation/compile";
import { providerText } from "../server/generation/spec";
import type { PlanV2 } from "../lib/plan";

const plan = realPlan as PlanV2;
function speechFor(text: string, secondsPerChar = 0.07) {
  const characters = [...text];
  return { text, durationSeconds: characters.length * secondsPerChar, alignment: { characters, character_start_times_seconds: characters.map((_, i) => i * secondsPerChar), character_end_times_seconds: characters.map((_, i) => (i + 1) * secondsPerChar) } };
}
const texts = Object.fromEntries(plan.scenes.map((s) => [s.id, providerText(s)]));
const speech = Object.fromEntries(plan.scenes.map((s) => [s.id, speechFor(texts[s.id])]));

test("compiles contiguous scenes in the prototype timeline shape within 60–90 s", () => {
  const t = compileTimeline(plan, speech, { [plan.scenes[0].id]: "audio/a.mp3" }, texts);
  assert.equal(t.fps, FPS);
  assert.ok(t.frames >= 1800 && t.frames <= 2700);
  let end = 0;
  for (const scene of t.scenes) {
    assert.equal(scene.start, end);
    end += scene.frames;
    assert.ok(scene.cueFrame >= 0 && scene.cueFrame < scene.frames);
    assert.ok(scene.captions.every((c) => c.text.length <= 54 && c.end > c.start && c.end <= scene.frames));
  }
  assert.equal(t.scenes[0].audioFile, "audio/a.mp3");
  assert.deepEqual(t.scenes[1].comparison, plan.scenes[1].visual.data);
  assert.deepEqual(t.scenes[0].labels, (plan.scenes[0].visual.data as { steps: { label: string }[] }).steps.map((s) => s.label));
});

test("pronunciation substitutions time from spoken text while captions keep the written words", () => {
  const scene = plan.scenes.find((s) => s.pronunciation.length > 0)!;
  assert.ok(scene, "fixture has a pronunciation entry");
  assert.notEqual(texts[scene.id], scene.narration);
  const t = compileTimeline(plan, speech, {}, texts);
  const captions = t.scenes.find((s) => s.id === scene.id)!.captions.map((c) => c.text).join(" ");
  assert.equal(captions, scene.narration.trim().split(/\s+/).join(" "), "captions show the approved narration, not the spoken form");
  assert.ok(!captions.includes(scene.pronunciation[0].spokenAs) || scene.narration.includes(scene.pronunciation[0].spokenAs));
});

test("recordings that don't match the approved text, are missing, or fall outside 60–90 s are rejected", () => {
  const id = plan.scenes[0].id;
  assert.throws(() => compileTimeline(plan, { ...speech, [id]: speechFor("Something else entirely.") }, {}, texts), (e: CompileError) => e.code === "INVALID_ALIGNMENT");
  const { [id]: _missing, ...partial } = speech;
  assert.throws(() => compileTimeline(plan, partial, {}, texts), (e: CompileError) => e.code === "INVALID_ALIGNMENT");
  const fast = Object.fromEntries(plan.scenes.map((s) => [s.id, speechFor(texts[s.id], 0.03)]));
  assert.throws(() => compileTimeline(plan, fast, {}, texts), (e: CompileError) => e.code === "DURATION_OUT_OF_RANGE");
});

test("captions carry code-point source spans and display-only overrides replace whole lines without retiming", () => {
  const base = compileTimeline(plan, speech, {}, texts);
  const scene = base.scenes[0];
  const narration = [...plan.scenes[0].narration];
  for (const c of scene.captions) assert.equal(narration.slice(c.sourceStart, c.sourceEnd).join("").split(/\s+/).join(" "), c.text);
  const line = scene.captions[0];
  const fixed = compileTimeline(plan, speech, {}, texts, { [scene.id]: [{ sourceStart: line.sourceStart, sourceEnd: line.sourceEnd, displayText: "Corrected line" }] });
  assert.deepEqual(fixed.scenes[0].captions[0], { ...line, text: "Corrected line" });
  assert.deepEqual(fixed.scenes[0].captions.slice(1), scene.captions.slice(1));
  assert.equal(fixed.frames, base.frames);
  assert.throws(() => compileTimeline(plan, speech, {}, texts, { [scene.id]: [{ sourceStart: line.sourceStart + 1, sourceEnd: line.sourceEnd, displayText: "Stale" }] }), (e: CompileError) => e.code === "LAYOUT_OVERFLOW", "stale corrections fail instead of silently dropping");
});
