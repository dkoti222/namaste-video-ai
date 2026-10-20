import { INSTAGRAM_SCOPES, type InstagramConfig } from "./config";

// Instagram API with Instagram Login adapter (Meta "Business Login for Instagram"). Server-only: the app secret and
// tokens never leave this module except as encrypted tokens. Error messages never include tokens or provider bodies.

export type InstagramAccount = { userId: string; username: string; accountType: "BUSINESS" | "CREATOR" | "UNSUPPORTED" };
export type TokenGrant = { accessToken: string; expiresInSeconds: number | null };

export interface InstagramProvider {
  authorizationUrl(state: string): string;
  /** Code → short-lived token, user ID and granted permissions. */
  exchangeCode(code: string): Promise<{ accessToken: string; userId: string; permissions: string[] }>;
  /** Short-lived → long-lived token (about 60 days). */
  longLivedToken(shortLivedToken: string): Promise<TokenGrant>;
  /** Refreshes a long-lived token that is at least 24 hours old and not expired. */
  refreshToken(longLivedToken: string): Promise<TokenGrant>;
  account(accessToken: string): Promise<InstagramAccount>;
}

export class InstagramProviderError extends Error {
  override name = "InstagramProviderError";
  constructor(
    readonly code: "PROVIDER_REJECTED" | "PROVIDER_UNAVAILABLE" | "INVALID_RESPONSE",
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

const TIMEOUT_MS = 15_000;

async function call(url: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
  } catch {
    throw new InstagramProviderError("PROVIDER_UNAVAILABLE", "Instagram could not be reached.");
  }
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok || !body) {
    throw new InstagramProviderError(response.status >= 500 ? "PROVIDER_UNAVAILABLE" : "PROVIDER_REJECTED", `Instagram returned HTTP ${response.status}.`, response.status);
  }
  return body;
}

const str = (value: unknown) => (typeof value === "string" && value.length > 0 ? value : typeof value === "number" ? String(value) : null);

function grant(body: Record<string, unknown>): TokenGrant {
  const accessToken = str(body.access_token);
  if (!accessToken) throw new InstagramProviderError("INVALID_RESPONSE", "Instagram returned no token.");
  const expires = Number(body.expires_in);
  return { accessToken, expiresInSeconds: Number.isFinite(expires) && expires > 0 ? expires : null };
}

/** Business/Creator accounts may report e.g. "BUSINESS", "Business", "MEDIA_CREATOR" or "CREATOR". */
export function normalizeAccountType(value: unknown): InstagramAccount["accountType"] {
  const type = String(value ?? "").toUpperCase();
  if (type.includes("BUSINESS")) return "BUSINESS";
  if (type.includes("CREATOR")) return "CREATOR";
  return "UNSUPPORTED";
}

export function instagramProvider(config: InstagramConfig): InstagramProvider {
  const graph = `https://graph.instagram.com`;
  return {
    authorizationUrl(state) {
      const url = new URL("https://www.instagram.com/oauth/authorize");
      url.searchParams.set("client_id", config.appId);
      url.searchParams.set("redirect_uri", config.redirectUri);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("scope", INSTAGRAM_SCOPES.join(","));
      url.searchParams.set("state", state);
      url.searchParams.set("enable_fb_login", "false");
      return url.toString();
    },
    async exchangeCode(code) {
      const form = new URLSearchParams({ client_id: config.appId, client_secret: config.appSecret, grant_type: "authorization_code", redirect_uri: config.redirectUri, code });
      const body = await call("https://api.instagram.com/oauth/access_token", { method: "POST", body: form, headers: { "Content-Type": "application/x-www-form-urlencoded" } });
      // Documented shape is {data:[{access_token,user_id,permissions}]}; some apps receive the flat object.
      const entry = (Array.isArray(body.data) ? body.data[0] : body) as Record<string, unknown> | undefined;
      const accessToken = str(entry?.access_token);
      const userId = str(entry?.user_id);
      if (!accessToken || !userId) throw new InstagramProviderError("INVALID_RESPONSE", "Instagram returned an incomplete token response.");
      const raw = entry?.permissions;
      const permissions = Array.isArray(raw) ? raw.map(String) : String(raw ?? "").split(",").map((p) => p.trim()).filter(Boolean);
      return { accessToken, userId, permissions };
    },
    async longLivedToken(shortLivedToken) {
      const url = new URL(`${graph}/access_token`);
      url.searchParams.set("grant_type", "ig_exchange_token");
      url.searchParams.set("client_secret", config.appSecret);
      url.searchParams.set("access_token", shortLivedToken);
      return grant(await call(url.toString()));
    },
    async refreshToken(longLivedToken) {
      const url = new URL(`${graph}/refresh_access_token`);
      url.searchParams.set("grant_type", "ig_refresh_token");
      url.searchParams.set("access_token", longLivedToken);
      return grant(await call(url.toString()));
    },
    async account(accessToken) {
      const url = new URL(`${graph}/${config.graphVersion}/me`);
      url.searchParams.set("fields", "user_id,username,account_type");
      url.searchParams.set("access_token", accessToken);
      const body = await call(url.toString());
      const userId = str(body.user_id) ?? str(body.id);
      const username = str(body.username);
      if (!userId || !username) throw new InstagramProviderError("INVALID_RESPONSE", "Instagram returned an incomplete account.");
      return { userId, username, accountType: normalizeAccountType(body.account_type) };
    },
  };
}

let testProvider: InstagramProvider | undefined;
/** Tests replace the network adapter; production always uses the configured provider. */
export function setInstagramProviderForTests(provider: InstagramProvider | undefined) {
  testProvider = provider;
}
export function getInstagramProvider(config: InstagramConfig): InstagramProvider {
  return testProvider ?? instagramProvider(config);
}

// Content publishing (Reels) for Instagram API with Instagram Login: container → processing → media_publish.
export type ContainerStatus = "IN_PROGRESS" | "FINISHED" | "PUBLISHED" | "ERROR" | "EXPIRED" | "UNKNOWN";

export interface InstagramPublisher {
  /** Creates a Reel container from a public HTTPS video URL that Instagram fetches. */
  createReelContainer(input: { instagramUserId: string; accessToken: string; videoUrl: string; caption: string }): Promise<string>;
  containerStatus(input: { containerId: string; accessToken: string }): Promise<ContainerStatus>;
  /** The publication side effect. Callers persist a submission barrier before calling. */
  publishContainer(input: { instagramUserId: string; accessToken: string; containerId: string }): Promise<string>;
  permalink(input: { mediaId: string; accessToken: string }): Promise<string | null>;
}

export function instagramPublisher(config: InstagramConfig): InstagramPublisher {
  const base = `https://graph.instagram.com/${config.graphVersion}`;
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const post = (url: string, token: string, params: Record<string, string>) =>
    call(url, { method: "POST", body: new URLSearchParams(params), headers: { ...auth(token), "Content-Type": "application/x-www-form-urlencoded" } });
  return {
    async createReelContainer({ instagramUserId, accessToken, videoUrl, caption }) {
      const body = await post(`${base}/${encodeURIComponent(instagramUserId)}/media`, accessToken, { media_type: "REELS", video_url: videoUrl, caption, share_to_feed: "true" });
      const id = str(body.id);
      if (!id) throw new InstagramProviderError("INVALID_RESPONSE", "Instagram returned no container.");
      return id;
    },
    async containerStatus({ containerId, accessToken }) {
      const body = await call(`${base}/${encodeURIComponent(containerId)}?fields=status_code`, { headers: auth(accessToken) });
      const code = String(body.status_code ?? "").toUpperCase();
      return (["IN_PROGRESS", "FINISHED", "PUBLISHED", "ERROR", "EXPIRED"].includes(code) ? code : "UNKNOWN") as ContainerStatus;
    },
    async publishContainer({ instagramUserId, accessToken, containerId }) {
      const body = await post(`${base}/${encodeURIComponent(instagramUserId)}/media_publish`, accessToken, { creation_id: containerId });
      const id = str(body.id);
      if (!id) throw new InstagramProviderError("INVALID_RESPONSE", "Instagram returned no media ID.");
      return id;
    },
    async permalink({ mediaId, accessToken }) {
      const body = await call(`${base}/${encodeURIComponent(mediaId)}?fields=permalink`, { headers: auth(accessToken) });
      const link = str(body.permalink);
      return link && /^https:\/\/(www\.)?instagram\.com\//.test(link) ? link : null;
    },
  };
}

let testPublisher: InstagramPublisher | undefined;
export function setInstagramPublisherForTests(publisher: InstagramPublisher | undefined) {
  testPublisher = publisher;
}
export function getInstagramPublisher(config: InstagramConfig): InstagramPublisher {
  return testPublisher ?? instagramPublisher(config);
}
