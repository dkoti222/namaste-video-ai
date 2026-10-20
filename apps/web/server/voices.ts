// Narrator presets (PRD voice rules). Only configured voices are offered; Daniel is the accepted test voice.
// Indian presets become available when their ElevenLabs voice IDs are configured for the web app.

type Env = Record<string, string | undefined>;

export type VoicePresetInfo = { preset: string; label: string; accent: string; testOnly: boolean };

// Voice IDs are server-only configuration and never reach the client.
const CATALOG: (VoicePresetInfo & { requiresEnv?: string; voiceId: (env: Env) => string | undefined })[] = [
  { preset: "daniel-test", label: "Daniel — English (test voice)", accent: "British English", testOnly: true, voiceId: () => "onwK4e9ZLuTAKqWW03F9" },
  { preset: "indian-english-male", label: "Indian English — male", accent: "Indian English", testOnly: false, requiresEnv: "ELEVENLABS_VOICE_ID_INDIAN_MALE", voiceId: (env) => env.ELEVENLABS_VOICE_ID_INDIAN_MALE?.trim() },
  { preset: "indian-english-female", label: "Indian English — female", accent: "Indian English", testOnly: false, requiresEnv: "ELEVENLABS_VOICE_ID_INDIAN_FEMALE", voiceId: (env) => env.ELEVENLABS_VOICE_ID_INDIAN_FEMALE?.trim() },
];

export const DEFAULT_VOICE_PRESET = "daniel-test";

export function availableVoices(env: Env = process.env): VoicePresetInfo[] {
  return CATALOG.filter((voice) => !voice.requiresEnv || env[voice.requiresEnv]?.trim()).map(({ requiresEnv: _r, voiceId: _v, ...voice }) => voice);
}

export function isVoiceAvailable(preset: string, env: Env = process.env): boolean {
  return availableVoices(env).some((voice) => voice.preset === preset);
}

/** Server-only: the provider voice ID for an available preset. */
export function providerVoiceId(preset: string, env: Env = process.env): string | null {
  if (!isVoiceAvailable(preset, env)) return null;
  return CATALOG.find((voice) => voice.preset === preset)?.voiceId(env) ?? null;
}
