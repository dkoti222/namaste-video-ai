import { requireApiOwner } from "@/server/api-session";
import { getAuthServices } from "@/server/auth/auth";
import { handle, jsonData, notFound, readJson } from "@/server/http";
import { projectsContext } from "@/server/projects/context";
import { commandIdentity, deleteProject, deleteProjectBody, getProject, updateProject, updateProjectBody } from "@/server/projects/service";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  return handle(async (requestId) => {
    const services = await getAuthServices();
    const { ownerId } = await requireApiOwner(request, services, { mutation: false });
    const view = await getProject(services.db, ownerId, (await params).id);
    if (!view) throw notFound();
    return jsonData(requestId, view);
  });
}

export async function PATCH(request: Request, { params }: Context) {
  return handle(async (requestId) => {
    const services = await getAuthServices();
    const { ownerId } = await requireApiOwner(request, services, { mutation: true });
    const body = await readJson(request, updateProjectBody);
    return jsonData(requestId, await updateProject(projectsContext(services), ownerId, (await params).id, body));
  });
}

export async function DELETE(request: Request, { params }: Context) {
  return handle(async (requestId) => {
    const services = await getAuthServices();
    const { ownerId } = await requireApiOwner(request, services, { mutation: true });
    const { id } = await params;
    const body = await readJson(request, deleteProjectBody);
    const identity = commandIdentity(request, ownerId, `/api/projects/${id}`, body);
    const { operation, replayed } = await deleteProject(projectsContext(services), identity, id, body);
    return jsonData(requestId, operation, {
      status: 202,
      headers: { Location: operation.statusUrl, ...(replayed ? { "Idempotency-Replayed": "true" } : {}) },
    });
  });
}
