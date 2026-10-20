import { requireApiOwner } from "@/server/api-session";
import { getAuthServices } from "@/server/auth/auth";
import { handle, jsonData, readJson } from "@/server/http";
import { accessBody, createAccessGrant, StorageUnavailableError } from "@/server/media/assets";
import { getObjectStore } from "@/server/media/object-store";

// V06: short-lived (10-minute) revocable media URL for the owner's ready asset. Not idempotent by design.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async (requestId) => {
    const services = await getAuthServices();
    const { ownerId } = await requireApiOwner(request, services, { mutation: true });
    const store = getObjectStore();
    if (!store) throw new StorageUnavailableError();
    const { purpose } = await readJson(request, accessBody);
    return jsonData(requestId, await createAccessGrant(services.db, store, ownerId, (await params).id, purpose));
  });
}
