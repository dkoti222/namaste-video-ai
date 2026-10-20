import { requireApiOwner } from "@/server/api-session";
import { getAuthServices } from "@/server/auth/auth";
import { getDraft, updateDraft, updateDraftBody } from "@/server/drafts/service";
import { handle, jsonData, notFound, readJson } from "@/server/http";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  return handle(async (requestId) => {
    const services = await getAuthServices();
    const { ownerId } = await requireApiOwner(request, services, { mutation: false });
    const draft = await getDraft(services.db, ownerId, (await params).id);
    if (!draft) throw notFound();
    return jsonData(requestId, draft);
  });
}

export async function PATCH(request: Request, { params }: Context) {
  return handle(async (requestId) => {
    const services = await getAuthServices();
    const { ownerId } = await requireApiOwner(request, services, { mutation: true });
    const body = await readJson(request, updateDraftBody);
    return jsonData(requestId, await updateDraft(services, ownerId, (await params).id, body));
  });
}
