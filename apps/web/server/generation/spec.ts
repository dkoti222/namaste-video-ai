import { canonicalJson, sha256Hex } from "../../lib/canonical";
import { cueIndex, type PlanV2 } from "../../lib/plan";
import { availableVoices, providerVoiceId } from "../voices";

// Render spec, voice configuration and speech fingerprints (DB_DESIGN.md sections 2.3 and 4.1).

export const COMPILER_VERSION = "prototype-compile-1";
export const REGISTRY_VERSION = 1;
export const RENDERER_BUILD_ID = "remotion-4.0.529-local";
export const FONT_VERSION = "dm-sans-5.2.6";
export const NORMALIZATION_VERSION = 1;

export type VoiceConfig = {
  preset: string;
  provider: "elevenlabs";
  model: string;
  voiceId: string;
  settings: { stability: number; similarityBoost: number };
  normalizationVersion: number;
  testOnly: boolean;
  accent: string;
};

/** Resolves the narrator server-side at approval time; the exact configuration is recorded with the video. */
export function resolveVoice(preset: string, env: Record<string, string | undefined> = process.env): VoiceConfig | null {
  const info = availableVoices(env).find((v) => v.preset === preset);
  const voiceId = providerVoiceId(preset, env);
  if (!info || !voiceId) return null;
  return {
    preset,
    provider: "elevenlabs",
    model: env.ELEVENLABS_MODEL?.trim() || "eleven_multilingual_v2",
    voiceId,
    settings: { stability: 0.5, similarityBoost: 0.75 },
    normalizationVersion: NORMALIZATION_VERSION,
    testOnly: info.testOnly,
    accent: info.accent,
  };
}

export type RenderSpec = {
  schemaVersion: 1;
  storyboardId: string;
  storyHash: string;
  voiceConfig: VoiceConfig;
  visualOverrides: unknown[];
  captionOverrides: unknown[];
  compilerVersion: string;
  registryVersion: number;
  rendererBuildId: string;
  fontVersion: string;
  assetBindings: Record<string, string>;
};

export function buildRenderSpec(storyboard: { id: string; storyHash: string }, voiceConfig: VoiceConfig, captionOverrides: unknown[] = []): { renderSpec: RenderSpec; renderSpecHash: string } {
  const renderSpec: RenderSpec = {
    schemaVersion: 1,
    storyboardId: storyboard.id,
    storyHash: storyboard.storyHash,
    voiceConfig,
    visualOverrides: [],
    captionOverrides,
    compilerVersion: COMPILER_VERSION,
    registryVersion: REGISTRY_VERSION,
    rendererBuildId: RENDERER_BUILD_ID,
    fontVersion: FONT_VERSION,
    assetBindings: {},
  };
  return { renderSpec, renderSpecHash: sha256Hex(canonicalJson(renderSpec)) };
}

/** Text sent to the provider: narration with reviewed pronunciation substitutions applied (later occurrences first). */
export function providerText(scene: PlanV2["scenes"][number]): string {
  let text = scene.narration;
  const edits = scene.pronunciation
    .map((p) => ({ ...p, at: cueIndex(scene.narration, p.phrase, p.occurrence) }))
    .filter((p) => p.at >= 0)
    .sort((a, b) => b.at - a.at);
  for (const p of edits) text = text.slice(0, p.at) + p.spokenAs + text.slice(p.at + p.phrase.length);
  return text;
}

/** Owner/project-namespaced speech cache key (no cross-user reuse in V1). */
export function speechFingerprint(ownerId: string, projectId: string, voice: VoiceConfig, text: string): string {
  return sha256Hex(
    canonicalJson({
      ownerId,
      projectId,
      provider: voice.provider,
      model: voice.model,
      voiceId: voice.voiceId,
      settings: voice.settings,
      normalizationVersion: voice.normalizationVersion,
      text,
    }),
  );
}
