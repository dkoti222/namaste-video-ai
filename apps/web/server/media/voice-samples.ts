import fs from "node:fs/promises";
import path from "node:path";
import type { Db } from "mongodb";
import { providerVoiceId } from "../voices";
import { storeVoiceSample } from "./assets";
import type { ObjectStore } from "./object-store";

// Narrator preview samples: generated once by an operator with ElevenLabs and stored in the private R2 voice catalog
// (voiceSamples collection). Served only through short-lived media grants.

export const SAMPLE_TEXT = "Namaste! I’m Daniel. I’ll narrate your video, one clear idea at a time.";

function configuration(preset: string, env: Record<string, string | undefined>) {
  return { preset, voiceId: providerVoiceId(preset, env), model: env.ELEVENLABS_MODEL?.trim() || "eleven_multilingual_v2", text: SAMPLE_TEXT, settings: { stability: 0.5, similarityBoost: 0.75 } };
}

function isMp3(audio: Buffer) {
  return audio.length >= 1000 && (audio.subarray(0, 3).toString() === "ID3" || (audio[0] === 0xff && (audio[1] & 0xe0) === 0xe0));
}

/** Operator action: synthesizes one short sample (about SAMPLE_TEXT.length ElevenLabs characters) into the catalog. */
export async function generateSample(db: Db, store: ObjectStore, preset: string, env: Record<string, string | undefined> = process.env, fetchImpl: typeof fetch = fetch) {
  const voiceId = providerVoiceId(preset, env);
  const apiKey = env.ELEVENLABS_API_KEY?.trim();
  if (!voiceId) throw new Error(`Voice preset ${preset} is not available.`);
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY is not configured for the web app.");
  const config = configuration(preset, env);
  const response = await fetchImpl(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "xi-api-key": apiKey, Accept: "audio/mpeg" },
    body: JSON.stringify({ text: SAMPLE_TEXT, model_id: config.model, voice_settings: { stability: 0.5, similarity_boost: 0.75 } }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`ElevenLabs returned HTTP ${response.status}.`);
  const audio = Buffer.from(await response.arrayBuffer());
  if (!isMp3(audio)) throw new Error("ElevenLabs did not return MP3 audio.");
  return storeVoiceSample(db, store, { preset, audio, configuration: config });
}

/** Operator action: moves a previously generated local sample (F08) into the catalog without new ElevenLabs usage. */
export async function importLocalSample(db: Db, store: ObjectStore, preset: string, env: Record<string, string | undefined> = process.env) {
  if (!/^[a-z0-9-]{1,64}$/.test(preset)) throw new Error("Invalid preset.");
  const audio = await fs.readFile(path.join(process.cwd(), "voice-samples", `${preset}.mp3`));
  if (!isMp3(audio)) throw new Error("The local sample is not MP3 audio.");
  return storeVoiceSample(db, store, { preset, audio, configuration: configuration(preset, env) });
}
