import { after } from "next/server";
import { readGeminiConfig } from "@/server/ai/gemini";
import { generateStoryboard } from "@/server/ai/planner";
import { requireApiOwner } from "@/server/api-session";
import { getAuthServices } from "@/server/auth/auth";
import { commandIdentity } from "@/server/commands";
import { ApiError, handle, jsonData, jsonList, notFound, readJson, readQuery } from "@/server/http";
import { acceptStoryboard, createStoryboardBody, listStoryboards, listStoryboardsQuery, runStoryboard } from "@/server/storyboards/service";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  return handle(async (requestId) => {
    const services = await getAuthServices();
    const { ownerId } = await requireApiOwner(request, services, { mutation: false });
    const page = await listStoryboards(services.db, services.config.secret, ownerId, (await params).id, readQuery(request, listStoryboardsQuery));
    if (!page) throw notFound();
    return jsonList(requestId, page.items, { nextCursor: page.nextCursor, hasMore: page.hasMore });
  });
}

export async function POST(request: Request, { params }: Context) {
  return handle(async (requestId) => {
    const services = await getAuthServices();
    const { ownerId } = await requireApiOwner(request, services, { mutation: true });
    const { id } = await params;
    const body = await readJson(request, createStoryboardBody);
    const gemini = readGeminiConfig();
    if (!gemini) throw new ApiError(503, "INTEGRATION_UNAVAILABLE", "Storyboard creation isn’t available right now.", { retryable: true });
    const identity = commandIdentity(request, ownerId, `/api/projects/${id}/storyboards`, body);
    const { jobId, replayed } = await acceptStoryboard(services, identity, id, body);
    // Interim runner (see F08): atomic job claim prevents double execution by a replay or the future worker.
    after(() => runStoryboard(services, jobId, (input) => generateStoryboard(gemini, input), gemini.model));
    const statusUrl = `/api/jobs/${jobId}`;
    return jsonData(requestId, { jobId, resource: null, state: "queued", statusUrl }, { status: 202, headers: { Location: statusUrl, ...(replayed ? { "Idempotency-Replayed": "true" } : {}) } });
  });
}
