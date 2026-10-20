import { requireApiOwner } from "@/server/api-session";
import { getAuthServices } from "@/server/auth/auth";
import { handle, notFound } from "@/server/http";
import { voiceSampleGrant } from "@/server/media/assets";
import { isVoiceAvailable } from "@/server/voices";

// Narrator preview: issues a short-lived catalog grant and redirects to the media gateway.
export async function GET(request: Request, { params }: { params: Promise<{ preset: string }> }) {
  return handle(async (requestId) => {
    const services = await getAuthServices();
    const { ownerId } = await requireApiOwner(request, services, { mutation: false });
    const { preset } = await params;
    const url = isVoiceAvailable(preset) ? await voiceSampleGrant(services.db, ownerId, preset) : null;
    if (!url) throw notFound();
    return new Response(null, { status: 302, headers: { Location: url, "Cache-Control": "no-store", "X-Request-Id": requestId } });
  });
}
