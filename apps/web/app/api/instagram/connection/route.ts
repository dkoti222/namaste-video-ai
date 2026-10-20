import { requireApiOwner } from "@/server/api-session";
import { getAuthServices } from "@/server/auth/auth";
import { commandIdentity } from "@/server/commands";
import { handle, jsonData, readJson } from "@/server/http";
import { disconnect, disconnectBody, getConnection } from "@/server/instagram/service";

// I03: the owner's connection (or null). No tokens, scopes or app credentials are returned.
export async function GET(request: Request) {
  return handle(async (requestId) => {
    const services = await getAuthServices();
    const { ownerId } = await requireApiOwner(request, services, { mutation: false });
    return jsonData(requestId, await getConnection(services.db, ownerId));
  });
}

// I04 (Idempotency-Key): disconnect; pending unsubmitted posts are paused.
export async function DELETE(request: Request) {
  return handle(async (requestId) => {
    const services = await getAuthServices();
    const { ownerId } = await requireApiOwner(request, services, { mutation: true });
    const body = await readJson(request, disconnectBody);
    const { result, replayed } = await disconnect(services, commandIdentity(request, ownerId, "/api/instagram/connection", body), body);
    return jsonData(requestId, result, { headers: replayed ? { "Idempotency-Replayed": "true" } : {} });
  });
}
