import { getAuthServices } from "@/server/auth/auth";
import { signIn } from "@/server/auth/session";
import { handle } from "@/server/http";

export async function POST(request: Request) {
  return handle(async (requestId) => signIn(request, await getAuthServices(), requestId));
}
