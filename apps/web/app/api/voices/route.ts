import { requireApiOwner } from "@/server/api-session";
import { getAuthServices } from "@/server/auth/auth";
import { handle, jsonData } from "@/server/http";
import { enabledVoiceSamples } from "@/server/media/assets";
import { availableVoices, DEFAULT_VOICE_PRESET } from "@/server/voices";

// P10: only configured, available presets with accurate labels and, when generated, an authenticated sample URL.
export async function GET(request: Request) {
  return handle(async (requestId) => {
    const services = await getAuthServices();
    await requireApiOwner(request, services, { mutation: false });
    const samples = await enabledVoiceSamples(services.db);
    const voices = availableVoices().map((voice) => ({
      ...voice,
      sampleAssetId: null, // catalog samples are reached through sampleUrl (short-lived grant), not asset IDs
      sampleUrl: samples.has(voice.preset) ? `/api/voices/${voice.preset}/sample` : null,
    }));
    return jsonData(requestId, { voices, defaultPreset: DEFAULT_VOICE_PRESET });
  });
}
