import { ProviderError } from "../ai/gemini";

// ElevenLabs text-to-speech with character timestamps (the prototype's proven endpoint). Provider bodies and keys
// are never surfaced; a timeout after the request was sent is "outcome unknown" because characters may be charged.

export type Alignment = { characters: string[]; character_start_times_seconds: number[]; character_end_times_seconds: number[] };
export type Speech = { audio: Buffer; alignment: Alignment; durationSeconds: number };
export type SpeechVoice = { voiceId: string; model: string; stability: number; similarityBoost: number };
export type SpeechProvider = (text: string, voice: SpeechVoice) => Promise<Speech>;

export function validateAlignment(alignment: Alignment, text: string): number {
  const { characters, character_start_times_seconds: starts, character_end_times_seconds: ends } = alignment;
  if (!Array.isArray(characters) || characters.length === 0 || starts.length !== characters.length || ends.length !== characters.length) {
    throw new ProviderError("PROVIDER_REJECTED", true, "Narration timing data was incomplete.");
  }
  for (let i = 0; i < characters.length; i++) {
    if (!Number.isFinite(starts[i]) || !Number.isFinite(ends[i]) || starts[i] < 0 || ends[i] < starts[i] || (i > 0 && starts[i] < starts[i - 1])) {
      throw new ProviderError("PROVIDER_REJECTED", true, "Narration timing data was inconsistent.");
    }
  }
  if (characters.join("") !== text) throw new ProviderError("PROVIDER_REJECTED", true, "Narration timing did not match the script.");
  return ends[ends.length - 1];
}

/**
 * Maps an ElevenLabs error response to a safe, actionable error. ElevenLabs reports several different problems as
 * 401 (`detail.status`), so the reason decides whether a retry can help. Provider text is never shown verbatim.
 */
export function classifyRejection(status: number, body: unknown): ProviderError {
  const detail = (body as { detail?: unknown } | null)?.detail;
  const reason = typeof detail === "object" && detail && typeof (detail as { status?: unknown }).status === "string" ? (detail as { status: string }).status : "";
  if (reason === "quota_exceeded" || status === 429 && reason !== "too_many_concurrent_requests" && reason !== "system_busy") {
    return new ProviderError("PROVIDER_QUOTA", true, "Your ElevenLabs character quota is used up. Add credits or wait for the monthly reset, then retry — recorded scenes are kept.");
  }
  if (status === 429 || reason === "too_many_concurrent_requests" || reason === "system_busy" || status >= 500) {
    return new ProviderError("PROVIDER_TEMPORARY", true, "The voice service is busy. Retry in a moment — recorded scenes are kept.");
  }
  if (reason === "invalid_api_key" || reason === "missing_permissions" || reason === "needs_authorization") {
    return new ProviderError("PROVIDER_AUTH", false, "The voice service rejected the app’s API key. Check the ElevenLabs key and its text-to-speech permission.");
  }
  if (reason === "detected_unusual_activity") {
    return new ProviderError("PROVIDER_REJECTED", true, "ElevenLabs paused this account’s free usage for unusual activity. Check your ElevenLabs account, then retry.");
  }
  if (status === 401 || status === 403) {
    // Unknown refusal: a valid key that just recorded other scenes can be refused briefly; allow an explicit retry.
    return new ProviderError("PROVIDER_AUTH", true, "The voice service refused this request. Retry — recorded scenes are kept. If it keeps happening, check your ElevenLabs account.");
  }
  return new ProviderError("PROVIDER_REJECTED", false, "The voice service couldn’t record this scene.");
}

export function elevenLabsProvider(apiKey: string, fetchImpl: typeof fetch = fetch): SpeechProvider {
  return async (text, voice) => {
    let response: Response;
    try {
      response = await fetchImpl(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice.voiceId)}/with-timestamps?output_format=mp3_44100_128`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "xi-api-key": apiKey },
        body: JSON.stringify({ text, model_id: voice.model, voice_settings: { stability: voice.stability, similarity_boost: voice.similarityBoost } }),
        signal: AbortSignal.timeout(120_000),
      });
    } catch {
      throw new ProviderError("PROVIDER_OUTCOME_UNKNOWN", true, "The voice service didn’t respond in time; it may have recorded this scene.");
    }
    if (!response.ok) throw classifyRejection(response.status, await response.json().catch(() => null));
    const data = (await response.json().catch(() => null)) as { audio_base64?: string; alignment?: Alignment } | null;
    if (!data?.audio_base64 || !data.alignment) throw new ProviderError("PROVIDER_REJECTED", true, "The voice service returned no audio.");
    const audio = Buffer.from(data.audio_base64, "base64");
    const durationSeconds = validateAlignment(data.alignment, text);
    return { audio, alignment: data.alignment, durationSeconds };
  };
}
