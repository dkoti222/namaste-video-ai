import { after } from "next/server";
import { requireApiOwner } from "@/server/api-session";
import { getAuthServices } from "@/server/auth/auth";
import { commandIdentity } from "@/server/commands";
import { acceptGeneration, generationBody } from "@/server/generation/service";
import { handle, jsonData, readJson } from "@/server/http";
import { sendEvents } from "@/server/inngest/functions";
import { dispatchOutbox } from "@/server/jobs/outbox";

// G01: approve the exact saved storyboard and start generation (durable job via the outbox and Inngest).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async (requestId) => {
    const services = await getAuthServices();
    const { ownerId } = await requireApiOwner(request, services, { mutation: true });
    const { id } = await params;
    const body = await readJson(request, generationBody);
    const identity = commandIdentity(request, ownerId, `/api/projects/${id}/generations`, body);
    const { operation, replayed } = await acceptGeneration(services, identity, id, body);
    // Latency optimization only; the once-a-minute dispatcher delivers it if this fails.
    after(() => dispatchOutbox(services.db, sendEvents).catch(() => undefined));
    return jsonData(requestId, operation, { status: 202, headers: { Location: operation.statusUrl, ...(replayed ? { "Idempotency-Replayed": "true" } : {}) } });
  });
}
