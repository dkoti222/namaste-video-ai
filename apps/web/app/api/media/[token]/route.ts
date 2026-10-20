import { getAuthServices } from "@/server/auth/auth";
import { parseRange, resolveGrant } from "@/server/media/assets";
import { getObjectStore } from "@/server/media/object-store";

// Media gateway: streams private objects for a valid grant, with HTTP Range support for playback/seeking.
// The grant is the capability; responses are never cached by shared caches and never redirect to storage.

const baseHeaders = (contentType: string) => ({
  "Content-Type": contentType,
  "Accept-Ranges": "bytes",
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
});

async function serve(request: Request, token: string, withBody: boolean): Promise<Response> {
  const store = getObjectStore();
  if (!store) return new Response(null, { status: 503 });
  const { db } = await getAuthServices();
  const media = await resolveGrant(db, token);
  if (!media) return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });

  const headers: Record<string, string> = baseHeaders(media.contentType);
  if (media.download) headers["Content-Disposition"] = `attachment; filename="${media.filename}"`;
  const range = parseRange(request.headers.get("range"), media.bytes);
  if (range === "unsatisfiable") {
    return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${media.bytes}` } });
  }
  if (!withBody) {
    return new Response(null, { status: range ? 206 : 200, headers: { ...headers, "Content-Length": String(range ? range.end - range.start + 1 : media.bytes), ...(range ? { "Content-Range": `bytes ${range.start}-${range.end}/${media.bytes}` } : {}) } });
  }
  const object = await store.get(media.objectKey, range ?? undefined);
  if (!object) return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } }); // missing object
  if (range) {
    return new Response(object.stream, { status: 206, headers: { ...headers, "Content-Length": String(range.end - range.start + 1), "Content-Range": `bytes ${range.start}-${range.end}/${media.bytes}` } });
  }
  return new Response(object.stream, { status: 200, headers: { ...headers, "Content-Length": String(media.bytes) } });
}

type Context = { params: Promise<{ token: string }> };
export async function GET(request: Request, { params }: Context) {
  return serve(request, (await params).token, true);
}
export async function HEAD(request: Request, { params }: Context) {
  return serve(request, (await params).token, false);
}
