import { requireApiOwner } from "@/server/api-session";
import { getAuthServices } from "@/server/auth/auth";
import { handle, jsonList, notFound, readQuery } from "@/server/http";
import { listVideos, listVideosQuery } from "@/server/videos/service";

// V01: the project's videos, newest first.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async (requestId) => {
    const services = await getAuthServices();
    const { ownerId } = await requireApiOwner(request, services, { mutation: false });
    const page = await listVideos(services.db, services.config.secret, ownerId, (await params).id, readQuery(request, listVideosQuery));
    if (!page) throw notFound();
    return jsonList(requestId, page.items, { nextCursor: page.nextCursor, hasMore: page.hasMore });
  });
}
