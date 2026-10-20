import { requireApiOwner } from "@/server/api-session";
import { getAuthServices } from "@/server/auth/auth";
import { commandIdentity } from "@/server/commands";
import { cancelBody, cancelJob } from "@/server/generation/service";
import { handle, jsonData, notFound, readJson } from "@/server/http";
import { getJob } from "@/server/projects/service";

// G03: queued → cancelled immediately; running → cancel_requested (stops at the next stage boundary).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async (requestId) => {
    const services = await getAuthServices();
    const { ownerId } = await requireApiOwner(request, services, { mutation: true });
    const { id } = await params;
    const body = await readJson(request, cancelBody);
    const { replayed } = await cancelJob(services, commandIdentity(request, ownerId, `/api/jobs/${id}/cancel`, body), id, body);
    const job = await getJob(services.db, ownerId, id);
    if (!job) throw notFound();
    return jsonData(requestId, job, { headers: replayed ? { "Idempotency-Replayed": "true" } : {} });
  });
}
