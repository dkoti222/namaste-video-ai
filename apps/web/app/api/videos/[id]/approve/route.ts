import { requireApiOwner } from "@/server/api-session";
import { getAuthServices } from "@/server/auth/auth";
import { commandIdentity } from "@/server/commands";
import { handle, jsonData, readJson } from "@/server/http";
import { approveVideo, approveVideoBody } from "@/server/videos/service";

// V05: final approval of the exact reviewed output.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async (requestId) => {
    const services = await getAuthServices();
    const { ownerId } = await requireApiOwner(request, services, { mutation: true });
    const { id } = await params;
    const body = await readJson(request, approveVideoBody);
    const { approval, replayed } = await approveVideo(services, commandIdentity(request, ownerId, `/api/videos/${id}/approve`, body), id, body);
    return jsonData(requestId, approval, { headers: replayed ? { "Idempotency-Replayed": "true" } : {} });
  });
}
