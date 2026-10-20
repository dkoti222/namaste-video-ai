// Server-only Instagram (Instagram API with Instagram Login) configuration. Missing values disable the integration.

type Env = Record<string, string | undefined>;

export type InstagramConfig = {
  appId: string;
  appSecret: string;
  redirectUri: string;
  /** Pinned Graph API version for graph.instagram.com calls (verified against the live app). */
  graphVersion: string;
  /** Token-encryption key ring: version → 32-byte key. `currentKeyVersion` encrypts new tokens. */
  keys: Map<number, Buffer>;
  currentKeyVersion: number;
};

export const INSTAGRAM_SCOPES = ["instagram_business_basic", "instagram_business_content_publish"] as const;

export function readInstagramConfig(env: Env = process.env): InstagramConfig | null {
  const appId = env.INSTAGRAM_APP_ID?.trim();
  const appSecret = env.INSTAGRAM_APP_SECRET?.trim();
  const redirectUri = env.INSTAGRAM_REDIRECT_URI?.trim();
  const key = env.INSTAGRAM_TOKEN_KEY?.trim();
  if (!appId || !/^\d{5,30}$/.test(appId) || !appSecret || !redirectUri || !key || !/^[0-9a-f]{64}$/i.test(key)) return null;
  try {
    if (new URL(redirectUri).protocol !== "https:") return null;
  } catch {
    return null;
  }
  // One key version for now; rotation adds versions here while old ones keep decrypting existing tokens.
  const keys = new Map<number, Buffer>([[1, Buffer.from(key, "hex")]]);
  const currentKeyVersion = 1;
  return { appId, appSecret, redirectUri, graphVersion: env.INSTAGRAM_GRAPH_VERSION?.trim() || "v23.0", keys, currentKeyVersion };
}
