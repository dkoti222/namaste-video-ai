import { requireApiOwner } from "@/server/api-session";
import { getAuthServices } from "@/server/auth/auth";
import { handle, jsonData } from "@/server/http";
import { getIntent } from "@/server/publish/service";

// U04: one post's live status (polled by the Publish step).
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async (requestId) => {
    const services = await getAuthServices();
    const { ownerId } = await requireApiOwner(request, services, { mutation: false });
    return jsonData(requestId, await getIntent(services.db, ownerId, (await params).id), { headers: { "Cache-Control": "no-store" } });
  });
}
