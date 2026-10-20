import { z } from "zod";

// Shared runtime storyboard contract: PlanV2 (API_DESIGN.md section 4.2) and the visual component registry
// (DB_DESIGN.md section 4.1). Only components the current renderer implements are enabled; diagram, timeline and
// chart stay disabled until they are built and tested.

const ID = /^[a-z][a-z0-9-]{0,49}$/;
const codePoints = (text: string) => [...text].length;

export type FieldIssue = { path: string; code: string; message: string };

// ---- Schemas -----------------------------------------------------------------------------------------------------
// Strict schemas define an approvable plan. Draft schemas (DraftPlanV2) keep the same structural safety — shapes,
// IDs, enums, numeric ranges, array bounds, no unknown fields — but accept incomplete text up to hard caps, so edits
// are saved with visible issues instead of being rejected.

function buildSchemas(relaxed: boolean) {
  const text = (min: number, max: number) =>
    relaxed
      ? z.string().refine((value) => codePoints(value) <= Math.max(max * 2, max + 200), { message: "This text is too long." })
      : z.string().refine((value) => codePoints(value) >= min && codePoints(value) <= max, { message: `Use ${min}–${max} characters.` });
  const label = text(1, 30);
  const labelsData = z.strictObject({ labels: z.array(label).min(1).max(4) });
  const flowData = z.strictObject({
    steps: z.array(z.strictObject({ id: z.string().regex(ID), label })).min(2).max(4),
    edges: z.array(z.strictObject({ id: z.string().regex(ID), from: z.string().regex(ID), to: z.string().regex(ID) })).min(1).max(6),
  });
  const panel = z.strictObject({ heading: text(1, 18), points: z.array(text(1, 26)).min(1).max(3) });
  const comparisonData = z.strictObject({ left: panel, right: panel });
  const searchData = z.strictObject({
    values: z.array(z.number().int().min(0).max(99)).min(3).max(9),
    target: z.number().int().min(0).max(99),
    step: z.number().int().min(0).max(8),
    mode: z.enum(["setup", "compare", "result"]),
  });
  const data = { flow: flowData, comparison: comparisonData, "binary-search": searchData, labels: labelsData };

  const cue = z.strictObject({ phrase: text(1, 150), occurrence: z.number().int().min(1).max(20), offsetMs: z.number().int().min(-500).max(500) });
  const event = z.strictObject({ id: z.string().regex(ID), targetId: z.string().min(1).max(50), action: z.string().min(1).max(30), cue, durationMs: z.number().int().min(0).max(3000) });
  const scene = z.strictObject({
    id: z.string().regex(ID),
    title: text(1, 65),
    kicker: text(1, 35),
    narration: text(20, 1400),
    pronunciation: z.array(z.strictObject({ phrase: text(1, 150), occurrence: z.number().int().min(1).max(20), spokenAs: text(1, 150) })).max(20),
    visual: z.strictObject({ component: z.enum(COMPONENT_NAMES), version: z.literal(1), data: z.record(z.string(), z.unknown()) }),
    events: z.array(event).min(1).max(20),
    sourceIds: z.array(z.string().regex(ID)).max(20),
  });
  const plan = z.strictObject({
    schemaVersion: z.literal(2),
    title: text(1, 100),
    audience: text(0, 200),
    learningObjective: text(1, 500),
    language: z.literal("en"),
    voicePreset: z.string().min(1).max(64),
    sources: z.array(z.strictObject({ id: z.string().regex(ID), kind: z.enum(["provided_notes", "illustrative"]), text: text(0, 20000) })).max(20),
    scenes: z.array(scene).min(3).max(10),
  });
  return { data, plan };
}

const COMPONENT_NAMES = ["flow", "comparison", "binary-search", "water-overview", "evaporation", "condensation", "rain", "collection"] as const;
const strict = buildSchemas(false);
const relaxed = buildSchemas(true);

type Registry = Record<string, { version: 1; data: z.ZodType; draftData: z.ZodType; targets: (data: never) => string[]; actions: string[] }>;
type FlowData = z.infer<typeof strict.data.flow>;
type SearchData = z.infer<typeof strict.data["binary-search"]>;
type LabelsData = z.infer<typeof strict.data.labels>;

const labelComponent = { version: 1 as const, data: strict.data.labels, draftData: relaxed.data.labels, targets: labelTargets, actions: ["reveal", "emphasize"] };
export const COMPONENTS = {
  flow: { version: 1, data: strict.data.flow, draftData: relaxed.data.flow, targets: (d: FlowData) => ["diagram", ...d.steps.map((s) => s.id), ...d.edges.map((e) => e.id)], actions: ["reveal", "emphasize", "connect"] },
  comparison: { version: 1, data: strict.data.comparison, draftData: relaxed.data.comparison, targets: () => ["left", "right"], actions: ["reveal", "emphasize", "compare"] },
  "binary-search": { version: 1, data: strict.data["binary-search"], draftData: relaxed.data["binary-search"], targets: () => ["range", "midpoint"], actions: ["reveal", "eliminate", "found"] },
  "water-overview": labelComponent,
  evaporation: labelComponent,
  condensation: labelComponent,
  rain: labelComponent,
  collection: labelComponent,
} satisfies Registry;
function labelTargets(d: LabelsData) {
  return ["diagram", ...d.labels.map((_, index) => `label-${index}`)];
}
export type ComponentId = keyof typeof COMPONENTS;
export const COMPONENT_IDS = Object.keys(COMPONENTS) as ComponentId[];
export const WATER_COMPONENTS: ComponentId[] = ["water-overview", "evaporation", "condensation", "rain", "collection"];

export const planV2Schema = strict.plan;
export type PlanV2 = z.infer<typeof planV2Schema>;
export type SceneV2 = PlanV2["scenes"][number];

/**
 * DraftPlanV2 structural check for saving an edited working storyboard. Returns null when structurally safe,
 * otherwise the structural issues (which reject the save).
 */
export function draftPlanStructureIssues(input: unknown): FieldIssue[] | null {
  const parsed = relaxed.plan.safeParse(input);
  const issues: FieldIssue[] = parsed.success ? [] : parsed.error.issues.map((i) => ({ path: i.path.join("."), code: i.code.toUpperCase(), message: i.message }));
  if (parsed.success) {
    parsed.data.scenes.forEach((s, index) => {
      const data = COMPONENTS[s.visual.component].draftData.safeParse(s.visual.data);
      if (!data.success) for (const i of data.error.issues) issues.push({ path: `scenes.${index}.visual.data.${i.path.join(".")}`, code: i.code.toUpperCase(), message: i.message });
    });
  }
  return issues.length ? issues : null;
}

// ---- Semantic helpers ------------------------------------------------------------------------------------------

/** Code-unit index of the nth occurrence of phrase in text, or -1. */
export function cueIndex(narration: string, phrase: string, occurrence: number): number {
  let start = -1;
  for (let n = 0; n < occurrence; n++) {
    start = narration.indexOf(phrase, start + 1);
    if (start < 0) return -1;
  }
  return start;
}

export type SearchStep = { low: number; high: number; mid: number; outcome: "left" | "right" | "found" };

/** Lower-midpoint binary search trace, identical to the prototype renderer (src/pipeline/search.ts). */
export function binaryTrace(values: number[], target: number): SearchStep[] {
  let low = 0;
  let high = values.length - 1;
  const steps: SearchStep[] = [];
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const outcome = values[mid] === target ? "found" : values[mid] < target ? "right" : "left";
    steps.push({ low, high, mid, outcome });
    if (outcome === "found") break;
    if (outcome === "right") low = mid + 1;
    else high = mid - 1;
  }
  return steps;
}

const WORDS_PER_SECOND = 2.5;
export function estimateSeconds(plan: Pick<PlanV2, "scenes">): number {
  const words = plan.scenes.reduce((total, s) => total + s.narration.trim().split(/\s+/).filter(Boolean).length, 0);
  return Math.max(1, Math.round((words / WORDS_PER_SECOND) * 10) / 10);
}

/**
 * Full structural + semantic validation. Returns blocking issues (empty when valid) and non-blocking warnings.
 * Cross-collection facts (ownership, approvals) are service rules, not part of this contract.
 */
export function validatePlanV2(input: unknown, options: { allowedComponents?: readonly ComponentId[] } = {}): { plan: PlanV2 | null; issues: FieldIssue[]; warnings: FieldIssue[] } {
  const parsed = planV2Schema.safeParse(input);
  if (!parsed.success) {
    return { plan: null, warnings: [], issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), code: i.code.toUpperCase(), message: i.message })) };
  }
  const plan = parsed.data;
  const issues: FieldIssue[] = [];
  const warnings: FieldIssue[] = [];
  const issue = (path: string, code: string, message: string) => issues.push({ path, code, message });

  const sourceIds = new Set(plan.sources.map((s) => s.id));
  if (sourceIds.size !== plan.sources.length) issue("sources", "DUPLICATE_ID", "Source IDs must be unique.");
  if (plan.sources.reduce((n, s) => n + codePoints(s.text), 0) > 20000) issue("sources", "TOO_LONG", "Sources may contain at most 20,000 characters in total.");
  if (new Set(plan.scenes.map((s) => s.id)).size !== plan.scenes.length) issue("scenes", "DUPLICATE_ID", "Scene IDs must be unique.");

  let searchExample: { values: number[]; target: number } | null = null;
  let lastSearchStep = -1;
  plan.scenes.forEach((s, index) => {
    const at = `scenes.${index}`;
    const registry = COMPONENTS[s.visual.component];
    if (options.allowedComponents && !options.allowedComponents.includes(s.visual.component)) {
      issue(`${at}.visual.component`, "UNSUPPORTED_VISUAL", `The ${s.visual.component} visual isn’t available for this topic.`);
    }
    const data = registry.data.safeParse(s.visual.data);
    if (!data.success) {
      for (const i of data.error.issues) issue(`${at}.visual.data.${i.path.join(".")}`, "INVALID_DATA", i.message);
      return;
    }
    for (const id of s.sourceIds) if (!sourceIds.has(id)) issue(`${at}.sourceIds`, "UNKNOWN_SOURCE", `Unknown source ${id}.`);
    s.pronunciation.forEach((p, i) => {
      if (cueIndex(s.narration, p.phrase, p.occurrence) < 0) issue(`${at}.pronunciation.${i}`, "PHRASE_NOT_FOUND", `“${p.phrase}” does not appear in the narration.`);
    });
    if (new Set(s.events.map((e) => e.id)).size !== s.events.length) issue(`${at}.events`, "DUPLICATE_ID", "Event IDs must be unique within a scene.");
    const targets = (registry.targets as (d: unknown) => string[])(data.data);
    s.events.forEach((e, i) => {
      if (!targets.includes(e.targetId)) issue(`${at}.events.${i}.targetId`, "UNKNOWN_TARGET", `Unknown target ${e.targetId}.`);
      if (!registry.actions.includes(e.action)) issue(`${at}.events.${i}.action`, "UNKNOWN_ACTION", `Action ${e.action} isn’t allowed for ${s.visual.component}.`);
      if (cueIndex(s.narration, e.cue.phrase, e.cue.occurrence) < 0) issue(`${at}.events.${i}.cue`, "CUE_NOT_FOUND", `Cue “${e.cue.phrase}” (occurrence ${e.cue.occurrence}) is not in the narration.`);
    });

    if (s.visual.component === "flow") {
      const d = data.data as FlowData;
      const ids = [...d.steps.map((x) => x.id), ...d.edges.map((x) => x.id)];
      if (new Set(ids).size !== ids.length) issue(`${at}.visual.data`, "DUPLICATE_ID", "Flow step and edge IDs must be unique.");
      const steps = new Set(d.steps.map((x) => x.id));
      d.edges.forEach((e, i) => {
        if (!steps.has(e.from) || !steps.has(e.to) || e.from === e.to) issue(`${at}.visual.data.edges.${i}`, "INVALID_EDGE", "Edges must connect two different steps.");
      });
    }
    if (s.visual.component === "binary-search") {
      const d = data.data as SearchData;
      if (d.values.some((v, i) => i > 0 && v <= d.values[i - 1])) {
        issue(`${at}.visual.data.values`, "NOT_SORTED", "Search values must be distinct and ascending.");
        return;
      }
      if (searchExample && (searchExample.target !== d.target || searchExample.values.join() !== d.values.join())) {
        issue(`${at}.visual.data`, "INCONSISTENT_EXAMPLE", "Use the same sorted list and target throughout the search example.");
      }
      searchExample ??= { values: d.values, target: d.target };
      const trace = binaryTrace(d.values, d.target);
      if (d.step >= trace.length) issue(`${at}.visual.data.step`, "INVALID_STEP", "This step is beyond the computed search.");
      if (d.mode === "setup" && d.step !== 0) issue(`${at}.visual.data.step`, "INVALID_STEP", "The setup scene must use step 0.");
      if (d.mode === "result" && d.step !== trace.length - 1) issue(`${at}.visual.data.step`, "INVALID_STEP", "The result scene must use the final step.");
      if (d.step < lastSearchStep) issue(`${at}.visual.data.step`, "OUT_OF_ORDER", "Search steps must not go backwards.");
      lastSearchStep = Math.max(lastSearchStep, d.step);
      if (d.mode === "compare" && d.step < trace.length) {
        const reveal = s.events.find((e) => e.targetId === "midpoint" && e.action === "reveal");
        const expected = trace[d.step].outcome === "found" ? "found" : "eliminate";
        const decision = s.events.find((e) => e.targetId === "range" && e.action === expected);
        if (!reveal || !decision) {
          issue(`${at}.events`, "MISSING_DECISION", `A comparison scene needs a midpoint reveal and a “${expected}” decision.`);
        } else if (cueIndex(s.narration, decision.cue.phrase, decision.cue.occurrence) <= cueIndex(s.narration, reveal.cue.phrase, reveal.cue.occurrence)) {
          issue(`${at}.events`, "DECISION_BEFORE_MIDPOINT", "The decision cue must come after the midpoint cue.");
        }
      }
    }
  });

  const seconds = estimateSeconds(plan);
  if (seconds < 55 || seconds > 95) {
    warnings.push({ path: "scenes", code: "DURATION_ESTIMATE", message: `Estimated narration is about ${Math.round(seconds)} seconds; videos should be 60–90 seconds.` });
  }
  return { plan: issues.length ? null : plan, issues, warnings };
}
