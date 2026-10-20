import { after } from "next/server";
import { requireApiOwner } from "@/server/api-session";
import { getAuthServices } from "@/server/auth/auth";
import { commandIdentity } from "@/server/commands";
import { handle, jsonData, readJson } from "@/server/http";
import { sendEvents } from "@/server/inngest/functions";
import { dispatchOutbox } from "@/server/jobs/outbox";
import { StorageUnavailableError } from "@/server/media/assets";
import { getObjectStore } from "@/server/media/object-store";
import { acceptCaptionRevision, captionsBody, getCaptions } from "@/server/videos/captions";

type Context = { params: Promise<{ id: string }> };

// V03: caption lines with source spans.
export async function GET(request: Request, { params }: Context) {
  return handle(async (requestId) => {
    const services = await getAuthServices();
    const { ownerId } = await requireApiOwner(request, services, { mutation: false });
    const store = getObjectStore();
    if (!store) throw new StorageUnavailableError();
    return jsonData(requestId, await getCaptions(services.db, store, ownerId, (await params).id));
  });
}

// V04: display-only caption corrections → new video version (speech reused), needs its own final approval.
export async function PATCH(request: Request, { params }: Context) {
  return handle(async (requestId) => {
    const services = await getAuthServices();
    const { ownerId } = await requireApiOwner(request, services, { mutation: true });
    const store = getObjectStore();
    if (!store) throw new StorageUnavailableError();
    const { id } = await params;
    const body = await readJson(request, captionsBody);
    const { operation, replayed } = await acceptCaptionRevision(services, store, commandIdentity(request, ownerId, `/api/videos/${id}/captions`, body), id, body);
    // Latency optimization only (the dispatcher cron delivers it otherwise); skipped outside a request scope (tests).
    try {
      after(() => dispatchOutbox(services.db, sendEvents).catch(() => undefined));
    } catch {}
    return jsonData(requestId, operation, { status: 202, headers: { Location: operation.statusUrl, ...(replayed ? { "Idempotency-Replayed": "true" } : {}) } });
  });
}
