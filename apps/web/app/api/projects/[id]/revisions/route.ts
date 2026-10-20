import { after } from "next/server";
import { readGeminiConfig } from "@/server/ai/gemini";
import { reviseStoryboard } from "@/server/ai/planner";
import { requireApiOwner } from "@/server/api-session";
import { getAuthServices } from "@/server/auth/auth";
import { commandIdentity } from "@/server/commands";
import { ApiError, handle, jsonData, readJson } from "@/server/http";
import { acceptRevision, revisionBody, runRevision } from "@/server/storyboards/service";

// S08: conversational revision of the working storyboard → immutable candidate with changed scenes.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async (requestId) => {
    const services = await getAuthServices();
    const { ownerId } = await requireApiOwner(request, services, { mutation: true });
    const { id } = await params;
    const body = await readJson(request, revisionBody);
    const gemini = readGeminiConfig();
    if (!gemini) throw new ApiError(503, "INTEGRATION_UNAVAILABLE", "Revisions aren’t available right now.", { retryable: true });
    const identity = commandIdentity(request, ownerId, `/api/projects/${id}/revisions`, body);
    const { jobId, replayed } = await acceptRevision(services, identity, id, body);
    after(() => runRevision(services, jobId, (input) => reviseStoryboard(gemini, input), gemini.model));
    const statusUrl = `/api/jobs/${jobId}`;
    return jsonData(requestId, { jobId, resource: null, state: "queued", statusUrl }, { status: 202, headers: { Location: statusUrl, ...(replayed ? { "Idempotency-Replayed": "true" } : {}) } });
  });
}
