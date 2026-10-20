import { getAuthServices } from "@/server/auth/auth";
import { getSessionResponse } from "@/server/auth/session";
import { handle } from "@/server/http";

export async function GET(request: Request) {
  return handle(async (requestId) => getSessionResponse(request, await getAuthServices(), requestId));
}
