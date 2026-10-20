import { z } from "zod";
import { requireApiOwner } from "@/server/api-session";
import { getAuthServices } from "@/server/auth/auth";
import { handle, jsonList, readQuery } from "@/server/http";
import { listIntents } from "@/server/publish/service";

const query = z.object({ limit: z.coerce.number().int().min(1).max(50).default(20), cursor: z.string().max(2048).optional() }).strict();

// U03: the project's posts, newest first.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async (requestId) => {
    const services = await getAuthServices();
    const { ownerId } = await requireApiOwner(request, services, { mutation: false });
    const { limit, cursor } = readQuery(request, query);
    const page = await listIntents(services.db, services.config.secret, ownerId, (await params).id, { limit, cursor });
    return jsonList(requestId, page.items, page.page);
  });
}
