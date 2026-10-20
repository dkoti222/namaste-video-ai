import { requireApiOwner } from "@/server/api-session";
import { getAuthServices } from "@/server/auth/auth";
import { commandIdentity } from "@/server/commands";
import { handle, jsonData, readJson } from "@/server/http";
import { cancelIntent, revisionBody } from "@/server/publish/service";

// U06 (Idempotency-Key): cancel before publishing starts.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async (requestId) => {
    const services = await getAuthServices();
    const { ownerId } = await requireApiOwner(request, services, { mutation: true });
    const { id } = await params;
    const body = await readJson(request, revisionBody);
    const { intent, replayed } = await cancelIntent(services, commandIdentity(request, ownerId, `/api/publish-intents/${id}/cancel`, body), id, body);
    return jsonData(requestId, intent, { headers: replayed ? { "Idempotency-Replayed": "true" } : {} });
  });
}
