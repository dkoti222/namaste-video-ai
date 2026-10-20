import { after } from "next/server";
import { generateIdeas, readGeminiConfig } from "@/server/ai/gemini";
import { requireApiOwner } from "@/server/api-session";
import { getAuthServices } from "@/server/auth/auth";
import { commandIdentity } from "@/server/commands";
import { ApiError, handle, jsonData, readJson } from "@/server/http";
import { acceptBrainstorm, brainstormBody, runBrainstorm } from "@/server/jobs/brainstorm";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async (requestId) => {
    const services = await getAuthServices();
    const { ownerId } = await requireApiOwner(request, services, { mutation: true });
    const { id } = await params;
    const body = await readJson(request, brainstormBody);
    const gemini = readGeminiConfig();
    if (!gemini) throw new ApiError(503, "INTEGRATION_UNAVAILABLE", "Idea suggestions aren’t available right now.", { retryable: true });
    const identity = commandIdentity(request, ownerId, `/api/projects/${id}/brainstorm`, body);
    const { jobId, replayed } = await acceptBrainstorm(services, identity, id, body);
    // Interim runner: executes after the 202 response. The job claim is atomic, so a replay or the future
    // durable worker (F13) cannot run it twice.
    after(() => runBrainstorm(services, jobId, (snapshot) => generateIdeas(gemini, snapshot)));
    const statusUrl = `/api/jobs/${jobId}`;
    return jsonData(
      requestId,
      { jobId, resource: null, state: "queued", statusUrl },
      { status: 202, headers: { Location: statusUrl, ...(replayed ? { "Idempotency-Replayed": "true" } : {}) } },
    );
  });
}
