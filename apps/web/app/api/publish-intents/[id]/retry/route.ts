import { requireApiOwner } from "@/server/api-session";
import { getAuthServices } from "@/server/auth/auth";
import { commandIdentity } from "@/server/commands";
import { handle, jsonData, readJson } from "@/server/http";
import { dispatchSoon } from "@/server/publish/dispatch";
import { retryBody, retryIntent } from "@/server/publish/service";

// U07 (Idempotency-Key): explicit retry of a safe failure within the posting window.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async (requestId) => {
    const services = await getAuthServices();
    const { ownerId } = await requireApiOwner(request, services, { mutation: true });
    const { id } = await params;
    const body = await readJson(request, retryBody);
    const { intent, replayed } = await retryIntent(services, commandIdentity(request, ownerId, `/api/publish-intents/${id}/retry`, body), id, body);
    if (!replayed) dispatchSoon(services.db);
    return jsonData(requestId, intent, { headers: replayed ? { "Idempotency-Replayed": "true" } : {} });
  });
}
