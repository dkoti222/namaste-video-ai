// Shared JSON API conventions (API_DESIGN.md sections 2 and 11): envelopes, request IDs, no-store, Origin checks.
import { randomBytes } from "node:crypto";
import type { z } from "zod";
import { redactConnectionStrings } from "./db/config";

export const MAX_JSON_BYTES = 256 * 1024;

export type FieldError = { path: string; code: string; message: string };

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly options: { retryable?: boolean; fieldErrors?: FieldError[]; details?: Record<string, unknown>; headers?: Record<string, string> } = {},
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const newRequestId = () => `req_${randomBytes(16).toString("base64url")}`;

function baseHeaders(requestId: string, extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  headers.set("X-Request-Id", requestId);
  headers.set("Cache-Control", "private, no-store");
  return headers;
}

export function jsonData(requestId: string, data: unknown, init: { status?: number; headers?: HeadersInit } = {}): Response {
  const headers = baseHeaders(requestId, init.headers);
  headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify({ data, meta: { requestId } }), { status: init.status ?? 200, headers });
}

export const notFound = () => new ApiError(404, "NOT_FOUND", "This item is unavailable.");

export function noContent(requestId: string, headers?: HeadersInit): Response {
  return new Response(null, { status: 204, headers: baseHeaders(requestId, headers) });
}

export function errorResponse(requestId: string, error: ApiError, headers?: HeadersInit): Response {
  const responseHeaders = baseHeaders(requestId, headers);
  for (const [name, value] of Object.entries(error.options.headers ?? {})) responseHeaders.set(name, value);
  responseHeaders.set("Content-Type", "application/json");
  const body = {
    error: {
      code: error.code,
      message: error.message,
      requestId,
      retryable: error.options.retryable ?? false,
      ...(error.options.fieldErrors ? { fieldErrors: error.options.fieldErrors } : {}),
      ...(error.options.details ? { details: error.options.details } : {}),
    },
  };
  return new Response(JSON.stringify(body), { status: error.status, headers: responseHeaders });
}

/** Runs a route body with consistent error mapping; unexpected errors never leak details to the client. */
export async function handle(run: (requestId: string) => Promise<Response>): Promise<Response> {
  const requestId = newRequestId();
  try {
    return await run(requestId);
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(requestId, error);
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    console.error(`[${requestId}] ${redactConnectionStrings(detail)}`);
    return errorResponse(requestId, new ApiError(500, "INTERNAL_ERROR", "Something went wrong. Try again with the request ID if it continues."));
  }
}

/** Exact configured Origin is required for cookie-authenticated mutations, including sign-in. */
export function requireOrigin(request: Request, allowedOrigin: string): void {
  if (request.headers.get("origin") !== allowedOrigin) {
    throw new ApiError(403, "ORIGIN_NOT_ALLOWED", "This request did not come from the NamasteVideo app. Reload the page and try again.");
  }
}

export async function readJson<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  if (!/^application\/json(;|$)/i.test(request.headers.get("content-type") ?? "")) {
    throw new ApiError(415, "UNSUPPORTED_MEDIA_TYPE", "Send the request as JSON.");
  }
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_JSON_BYTES) throw new ApiError(413, "PAYLOAD_TOO_LARGE", "The request is too large.");
  const text = await request.text();
  if (Buffer.byteLength(text) > MAX_JSON_BYTES) throw new ApiError(413, "PAYLOAD_TOO_LARGE", "The request is too large.");

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new ApiError(400, "MALFORMED_JSON", "The request body is not valid JSON.");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError(422, "VALIDATION_FAILED", "Please correct the highlighted fields.", {
      fieldErrors: parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        code: issue.code.toUpperCase(),
        message: issue.message,
      })),
    });
  }
  return parsed.data;
}

export function jsonList(requestId: string, data: unknown[], page: { nextCursor: string | null; hasMore: boolean }): Response {
  const headers = baseHeaders(requestId);
  headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify({ data, page, meta: { requestId } }), { status: 200, headers });
}

export function readQuery<T>(request: Request, schema: z.ZodType<T>): T {
  const parsed = schema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) {
    throw new ApiError(400, "INVALID_QUERY", "The list options are not valid.", {
      fieldErrors: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), code: issue.code.toUpperCase(), message: issue.message })),
    });
  }
  return parsed.data;
}
