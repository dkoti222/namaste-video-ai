import { requireApiOwner } from "@/server/api-session";
import { getAuthServices } from "@/server/auth/auth";
import { handle, jsonData, notFound } from "@/server/http";
import { getJob } from "@/server/projects/service";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async (requestId) => {
    const services = await getAuthServices();
    const { ownerId } = await requireApiOwner(request, services, { mutation: false });
    const job = await getJob(services.db, ownerId, (await params).id);
    if (!job) throw notFound();
    return jsonData(requestId, job);
  });
}
