import { getAuthServices } from "@/server/auth/auth";
import { signOut } from "@/server/auth/session";
import { handle } from "@/server/http";

export async function POST(request: Request) {
  return handle(async (requestId) => signOut(request, await getAuthServices(), requestId));
}
