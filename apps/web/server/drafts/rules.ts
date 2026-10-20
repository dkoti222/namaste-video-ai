import { canonicalJson, sha256Hex } from "../../lib/canonical";
import { validatePlanV2 } from "../../lib/plan";
import type { FieldError } from "../http";
import { isVoiceAvailable } from "../voices";

// Draft rules shared by project creation, draft saves, storyboard creation and apply.

export function draftContentHash(draft: { topic: string; audience: string; notes: string; voicePreset: string; editablePlan: unknown }) {
  return sha256Hex(canonicalJson({ canonicalizationVersion: 1, ...draft }));
}

/** Issues that block storyboard creation: a meaningful topic and an available narrator. */
export function ideaIssues(draft: { topic: string; voicePreset: string }, env?: Record<string, string | undefined>): FieldError[] {
  const issues: FieldError[] = [];
  if (draft.topic.trim().length === 0) issues.push({ path: "topic", code: "REQUIRED", message: "Add a topic to create a storyboard." });
  if (!isVoiceAvailable(draft.voicePreset, env)) {
    issues.push({ path: "voicePreset", code: "VOICE_UNAVAILABLE", message: "This narrator isn’t available. Choose another voice." });
  }
  return issues;
}

/**
 * All draft issues: the idea plus, when a working storyboard exists, its full PlanV2 validation and narrator match.
 * Drafts may be saved with issues; approval requires none.
 */
export function draftIssues(
  draft: { topic: string; voicePreset: string; editablePlan?: unknown },
  env?: Record<string, string | undefined>,
): FieldError[] {
  const issues = ideaIssues(draft, env);
  const plan = draft.editablePlan as { voicePreset?: unknown } | null | undefined;
  if (plan) {
    for (const issue of validatePlanV2(plan).issues) issues.push({ ...issue, path: issue.path ? `editablePlan.${issue.path}` : "editablePlan" });
    if (plan.voicePreset !== draft.voicePreset) {
      issues.push({ path: "editablePlan.voicePreset", code: "VOICE_MISMATCH", message: "The storyboard was made for a different narrator. Create a new storyboard." });
    }
  }
  return issues.slice(0, 100);
}
