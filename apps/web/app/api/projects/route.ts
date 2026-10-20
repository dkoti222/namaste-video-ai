import { requireApiOwner } from "@/server/api-session";
import { getAuthServices } from "@/server/auth/auth";
import { handle, jsonData, jsonList, notFound, readJson, readQuery } from "@/server/http";
import { projectsContext } from "@/server/projects/context";
import { commandIdentity, createProject, createProjectBody, getProject, listProjects, listQuery } from "@/server/projects/service";

export async function GET(request: Request) {
  return handle(async (requestId) => {
    const services = await getAuthServices();
    const { ownerId } = await requireApiOwner(request, services, { mutation: false });
    const result = await listProjects(projectsContext(services), ownerId, readQuery(request, listQuery));
    return jsonList(requestId, result.items, { nextCursor: result.nextCursor, hasMore: result.hasMore });
  });
}

export async function POST(request: Request) {
  return handle(async (requestId) => {
    const services = await getAuthServices();
    const { ownerId } = await requireApiOwner(request, services, { mutation: true });
    const body = await readJson(request, createProjectBody);
    const identity = commandIdentity(request, ownerId, "/api/projects", body);
    const { projectId, replayed } = await createProject(projectsContext(services), identity, body);
    const view = await getProject(services.db, ownerId, projectId);
    if (!view) throw notFound();
    return jsonData(requestId, view, {
      status: 201,
      headers: { Location: `/api/projects/${projectId}`, ...(replayed ? { "Idempotency-Replayed": "true" } : {}) },
    });
  });
}
