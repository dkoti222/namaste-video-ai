import { cueIndex, type PlanV2 } from "../../lib/plan";
import type { Alignment } from "../speech/elevenlabs";

// Timeline compiler for the approved video style (the prototype Remotion composition in src/video, unchanged).
// Produces the prototype Timeline shape from PlanV2 + recorded speech. Unlike the prototype it supports reviewed
// pronunciation substitutions: timing comes from the provider text, captions keep the approved written narration.

export const FPS = 30;
export const MIN_FRAMES = 60 * FPS;
export const MAX_FRAMES = 90 * FPS;

export class CompileError extends Error {
  constructor(readonly code: "INVALID_ALIGNMENT" | "DURATION_OUT_OF_RANGE" | "LAYOUT_OVERFLOW", message: string) {
    super(message);
    this.name = "CompileError";
  }
}

export type SceneSpeech = { text: string; durationSeconds: number; alignment: Alignment };
/** sourceStart/sourceEnd: half-open Unicode code-point span in the scene's approved narration (API V03). */
export type Caption = { text: string; start: number; end: number; sourceStart: number; sourceEnd: number };
export type CaptionOverride = { sourceStart: number; sourceEnd: number; displayText: string };
export type TimedScene = {
  id: string;
  title: string;
  kicker: string;
  narration: string;
  type: string;
  labels: string[];
  cue: string;
  occurrence: number;
  search?: { values: number[]; target: number; step: number; mode: "setup" | "compare" | "result"; decisionCue?: string; decisionOccurrence: number };
  comparison?: { left: { heading: string; points: string[] }; right: { heading: string; points: string[] } };
  start: number;
  frames: number;
  cueFrame: number;
  decisionFrame?: number;
  captions: Caption[];
  audioFile?: string;
};
export type Timeline = { title: string; fixture: boolean; fps: number; frames: number; scenes: TimedScene[] };

type Substitution = { start: number; end: number; spoken: string };

function substitutions(scene: PlanV2["scenes"][number]): Substitution[] {
  return scene.pronunciation
    .map((p) => ({ start: cueIndex(scene.narration, p.phrase, p.occurrence), end: 0, spoken: p.spokenAs, length: p.phrase.length }))
    .filter((s) => s.start >= 0)
    .map((s) => ({ start: s.start, end: s.start + s.length, spoken: s.spoken }))
    .sort((a, b) => a.start - b.start);
}

/** Maps a narration UTF-16 offset to the provider-text offset (positions inside a substitution map to its edges). */
function toProvider(subs: Substitution[], position: number, edge: "start" | "end"): number {
  let delta = 0;
  for (const s of subs) {
    if (position < s.start) break;
    if (position < s.end) return s.start + delta + (edge === "end" ? s.spoken.length - 1 : 0);
    delta += s.spoken.length - (s.end - s.start);
  }
  return position + delta;
}

function timing(speech: SceneSpeech) {
  // Provider alignment may index code points; map UTF-16 offsets to alignment indices (as the prototype does).
  const offsets: number[] = [];
  speech.alignment.characters.forEach((c, i) => {
    for (let n = 0; n < c.length; n++) offsets.push(i);
  });
  const at = (providerOffset: number) => offsets[Math.min(Math.max(providerOffset, 0), offsets.length - 1)];
  return {
    start: (p: number) => speech.alignment.character_start_times_seconds[at(p)],
    end: (p: number) => speech.alignment.character_end_times_seconds[at(p)],
  };
}

const codePointAt = (text: string, utf16: number) => [...text.slice(0, utf16)].length;

function captions(narration: string, subs: Substitution[], speech: SceneSpeech, overrides: CaptionOverride[] = []): Caption[] {
  const t = timing(speech);
  const words = [...narration.matchAll(/\S+/g)].map((m) => ({
    text: m[0],
    start: t.start(toProvider(subs, m.index!, "start")),
    end: t.end(toProvider(subs, m.index! + m[0].length - 1, "end")),
    sourceStart: codePointAt(narration, m.index!),
    sourceEnd: codePointAt(narration, m.index! + m[0].length),
  }));
  const result: Caption[] = [];
  let group: typeof words = [];
  const flush = () => {
    if (!group.length) return;
    const start = Math.floor(group[0].start * FPS);
    result.push({ text: group.map((w) => w.text).join(" "), start, end: Math.max(start + 1, Math.ceil(group.at(-1)!.end * FPS)), sourceStart: group[0].sourceStart, sourceEnd: group.at(-1)!.sourceEnd });
    group = [];
  };
  for (const word of words) {
    if (word.text.length > 30) throw new CompileError("LAYOUT_OVERFLOW", `A word is too long for captions: “${word.text.slice(0, 20)}…”`);
    if (group.length && (group.map((w) => w.text).join(" ").length + word.text.length + 1 > 54 || word.end - group[0].start > 3.4)) flush();
    group.push(word);
    if (/[.!?;]$/.test(word.text)) flush();
  }
  flush();
  for (let i = 0; i < result.length - 1; i++) result[i].end = Math.min(result[i].end, result[i + 1].start);
  // Display-only corrections replace a whole caption line; timing and speech are unchanged.
  for (const override of overrides) {
    const target = result.find((c) => c.sourceStart === override.sourceStart && c.sourceEnd === override.sourceEnd);
    if (!target) throw new CompileError("LAYOUT_OVERFLOW", "A caption correction no longer matches a caption line.");
    target.text = override.displayText;
  }
  return result;
}

const TYPE: Record<string, string> = { "water-overview": "overview" };

export function compileTimeline(
  plan: PlanV2,
  speech: Record<string, SceneSpeech>,
  audioFiles: Record<string, string>,
  expectedText: Record<string, string>,
  captionOverrides: Record<string, CaptionOverride[]> = {},
): Timeline {
  let frame = 0;
  const scenes = plan.scenes.map((scene): TimedScene => {
    const s = speech[scene.id];
    if (!s) throw new CompileError("INVALID_ALIGNMENT", `Missing narration for scene ${scene.id}.`);
    if (s.text !== expectedText[scene.id] || s.alignment.characters.join("") !== s.text) {
      throw new CompileError("INVALID_ALIGNMENT", `Recorded narration doesn’t match the approved script in scene ${scene.id}.`);
    }
    const subs = substitutions(scene);
    const t = timing(s);
    const cueAt = (phrase: string, occurrence: number) => {
      const i = cueIndex(scene.narration, phrase, occurrence);
      if (i < 0) throw new CompileError("INVALID_ALIGNMENT", `Cue “${phrase}” is missing in scene ${scene.id}.`);
      return Math.floor(t.start(toProvider(subs, i, "start")) * FPS);
    };
    const data = scene.visual.data as Record<string, unknown>;
    const primary = scene.events[0];
    const decision = scene.visual.component === "binary-search" && (data.mode as string) === "compare" ? scene.events[1] : undefined;
    const labels =
      scene.visual.component === "flow"
        ? (data.steps as { label: string }[]).map((x) => x.label)
        : scene.visual.component === "comparison"
          ? [(data.left as { heading: string }).heading, (data.right as { heading: string }).heading]
          : scene.visual.component === "binary-search"
            ? []
            : (data.labels as string[]);
    const frames = Math.ceil((s.durationSeconds + 0.3) * FPS);
    const timed: TimedScene = {
      id: scene.id,
      title: scene.title,
      kicker: scene.kicker,
      narration: scene.narration,
      type: TYPE[scene.visual.component] ?? scene.visual.component,
      labels,
      cue: primary.cue.phrase,
      occurrence: primary.cue.occurrence,
      ...(scene.visual.component === "binary-search"
        ? { search: { ...(data as { values: number[]; target: number; step: number; mode: "setup" | "compare" | "result" }), ...(decision ? { decisionCue: decision.cue.phrase } : {}), decisionOccurrence: decision?.cue.occurrence ?? 1 } }
        : {}),
      ...(scene.visual.component === "comparison" ? { comparison: data as TimedScene["comparison"] } : {}),
      start: frame,
      frames,
      cueFrame: Math.min(frames - 1, cueAt(primary.cue.phrase, primary.cue.occurrence)),
      ...(decision ? { decisionFrame: Math.min(frames - 1, cueAt(decision.cue.phrase, decision.cue.occurrence)) } : {}),
      captions: captions(scene.narration, subs, s, captionOverrides[scene.id]),
      audioFile: audioFiles[scene.id],
    };
    frame += frames;
    return timed;
  });
  if (frame < MIN_FRAMES || frame > MAX_FRAMES) {
    throw new CompileError("DURATION_OUT_OF_RANGE", `The recorded narration is ${(frame / FPS).toFixed(1)} s; videos must be 60–90 s. Revise the storyboard and approve again.`);
  }
  return { title: plan.title, fixture: false, fps: FPS, frames: frame, scenes };
}
