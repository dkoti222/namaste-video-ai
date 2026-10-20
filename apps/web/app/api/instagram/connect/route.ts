import { requireApiOwner } from "@/server/api-session";
import { getAuthServices } from "@/server/auth/auth";
import { handle, jsonData, readJson } from "@/server/http";
import { connectBody, startConnect } from "@/server/instagram/service";

// I01: one-use, session-bound OAuth state → allowlisted Instagram authorization URL (not stored as a command receipt).
export async function POST(request: Request) {
  return handle(async (requestId) => {
    const services = await getAuthServices();
    const owner = await requireApiOwner(request, services, { mutation: true });
    const body = await readJson(request, connectBody);
    return jsonData(requestId, await startConnect(services.db, owner, body), { headers: { "Cache-Control": "no-store" } });
  });
}
