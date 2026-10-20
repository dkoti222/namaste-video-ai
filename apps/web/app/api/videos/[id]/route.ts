import { requireApiOwner } from "@/server/api-session";
import { getAuthServices } from "@/server/auth/auth";
import { handle, jsonData, notFound } from "@/server/http";
import { getVideo } from "@/server/videos/service";

// V02
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async (requestId) => {
    const services = await getAuthServices();
    const { ownerId } = await requireApiOwner(request, services, { mutation: false });
    const video = await getVideo(services.db, ownerId, (await params).id);
    if (!video) throw notFound();
    return jsonData(requestId, video);
  });
}
