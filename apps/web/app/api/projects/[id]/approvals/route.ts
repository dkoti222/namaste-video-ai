import { requireApiOwner } from "@/server/api-session";
import { getAuthServices } from "@/server/auth/auth";
import { commandIdentity } from "@/server/commands";
import { handle, jsonData, readJson } from "@/server/http";
import { approveBody, approveStoryboard } from "@/server/storyboards/service";

// Story approval (approval half of G01/T05; see PROJECT_STATUS F11). Approves the exact saved working storyboard.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async (requestId) => {
    const services = await getAuthServices();
    const { ownerId } = await requireApiOwner(request, services, { mutation: true });
    const { id } = await params;
    const body = await readJson(request, approveBody);
    const identity = commandIdentity(request, ownerId, `/api/projects/${id}/approvals`, body);
    const { approval, storyboard, replayed } = await approveStoryboard(services, identity, id, body);
    return jsonData(requestId, { approval, storyboard }, { status: 201, headers: replayed ? { "Idempotency-Replayed": "true" } : {} });
  });
}
