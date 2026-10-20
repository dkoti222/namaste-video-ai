import { requireApiOwner } from "@/server/api-session";
import { getAuthServices } from "@/server/auth/auth";
import { commandIdentity } from "@/server/commands";
import { applyStoryboard, applyStoryboardBody } from "@/server/drafts/service";
import { handle, jsonData, readJson } from "@/server/http";

// S07: make an earlier storyboard version the working copy (same checks as apply; later versions stay in history).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async (requestId) => {
    const services = await getAuthServices();
    const { ownerId } = await requireApiOwner(request, services, { mutation: true });
    const { id } = await params;
    const body = await readJson(request, applyStoryboardBody);
    const identity = commandIdentity(request, ownerId, `/api/projects/${id}/draft/restore`, body);
    const { draft, replayed } = await applyStoryboard(services, identity, id, body);
    return jsonData(requestId, draft, { headers: replayed ? { "Idempotency-Replayed": "true" } : {} });
  });
}
