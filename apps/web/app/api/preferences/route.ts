import { requireApiOwner } from "@/server/api-session";
import { getAuthServices } from "@/server/auth/auth";
import { handle, jsonData, readJson } from "@/server/http";
import { getPreferences, preferencesBody, updatePreferences } from "@/server/preferences";

// P08/P09: personal timezone and future-project default voice.
export async function GET(request: Request) {
  return handle(async (requestId) => {
    const services = await getAuthServices();
    const { ownerId } = await requireApiOwner(request, services, { mutation: false });
    return jsonData(requestId, await getPreferences(services.db, ownerId));
  });
}

export async function PATCH(request: Request) {
  return handle(async (requestId) => {
    const services = await getAuthServices();
    const { ownerId } = await requireApiOwner(request, services, { mutation: true });
    const body = await readJson(request, preferencesBody);
    return jsonData(requestId, await updatePreferences(services.db, ownerId, body));
  });
}
