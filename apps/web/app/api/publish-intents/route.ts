import { requireApiOwner } from "@/server/api-session";
import { getAuthServices } from "@/server/auth/auth";
import { commandIdentity } from "@/server/commands";
import { handle, jsonData, readJson } from "@/server/http";
import { dispatchSoon } from "@/server/publish/dispatch";
import { acceptPublish, publishBody } from "@/server/publish/service";

// U02 (Idempotency-Key): Post now — freezes the exact approved video, account and caption, then queues delivery.
export async function POST(request: Request) {
  return handle(async (requestId) => {
    const services = await getAuthServices();
    const { ownerId } = await requireApiOwner(request, services, { mutation: true });
    const body = await readJson(request, publishBody);
    const result = await acceptPublish(services, commandIdentity(request, ownerId, "/api/publish-intents", body), body);
    if (result.status === 201) dispatchSoon(services.db);
    const headers: Record<string, string> = { Location: `/api/publish-intents/${result.intent.id}` };
    if (result.replayed) headers["Idempotency-Replayed"] = "true";
    if (result.deduplicated) headers["X-Deduplicated"] = "true";
    return jsonData(requestId, result.intent, { status: result.status, headers });
  });
}
