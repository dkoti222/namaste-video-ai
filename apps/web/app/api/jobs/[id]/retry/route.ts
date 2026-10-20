import { after } from "next/server";
import { requireApiOwner } from "@/server/api-session";
import { getAuthServices } from "@/server/auth/auth";
import { commandIdentity } from "@/server/commands";
import { retryBody, retryJob } from "@/server/generation/service";
import { handle, jsonData, readJson } from "@/server/http";
import { sendEvents } from "@/server/inngest/functions";
import { dispatchOutbox } from "@/server/jobs/outbox";

// G04: new execution attempt of a failed generation on unchanged inputs; completed stages are reused.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async (requestId) => {
    const services = await getAuthServices();
    const { ownerId } = await requireApiOwner(request, services, { mutation: true });
    const { id } = await params;
    const body = await readJson(request, retryBody);
    const { operation, replayed } = await retryJob(services, commandIdentity(request, ownerId, `/api/jobs/${id}/retry`, body), id, body);
    after(() => dispatchOutbox(services.db, sendEvents).catch(() => undefined));
    return jsonData(requestId, operation, { status: 202, headers: { Location: operation.statusUrl, ...(replayed ? { "Idempotency-Replayed": "true" } : {}) } });
  });
}
