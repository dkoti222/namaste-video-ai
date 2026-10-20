import { getAuthServices } from "@/server/auth/auth";
import { currentSession } from "@/server/auth/session";
import { completeConnect, returnPath } from "@/server/instagram/service";

// I02: provider redirect. Always 303 to a server-generated relative route with an opaque outcome; never echoes
// provider query values or tokens, and never attaches an account without the initiating session.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const input = { code: url.searchParams.get("code"), state: url.searchParams.get("state"), error: url.searchParams.get("error") };
  let location: string;
  try {
    const services = await getAuthServices();
    const owner = await currentSession(request, services).then(
      ({ view, sessionHash }) => ({ ownerId: view.user.id, sessionHash }),
      () => null,
    );
    location = await completeConnect(services, owner, input);
  } catch (error) {
    console.error("[instagram] callback failed", error instanceof Error ? error.name : "unknown");
    location = returnPath("failed");
  }
  return new Response(null, { status: 303, headers: { Location: location, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}
