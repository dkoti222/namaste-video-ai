import { requireApiOwner } from "@/server/api-session";
import { getAuthServices } from "@/server/auth/auth";
import { handle, jsonData, notFound } from "@/server/http";
import { getStoryboard } from "@/server/storyboards/service";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async (requestId) => {
    const services = await getAuthServices();
    const { ownerId } = await requireApiOwner(request, services, { mutation: false });
    const storyboard = await getStoryboard(services.db, ownerId, (await params).id);
    if (!storyboard) throw notFound();
    return jsonData(requestId, storyboard);
  });
}
