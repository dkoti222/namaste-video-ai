import { betterAuth } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import type { Db, MongoClient } from "mongodb";
import { getMongoClient } from "../db/client";
import { readDatabaseConfig } from "../db/config";
import { isAdmitted } from "./access";
import { readAuthConfig, type AuthConfig } from "./config";
import { DEFAULT_LOGIN_LIMITS, type LoginLimits } from "./rate-limit";

export const SESSION_MAX_SECONDS = 7 * 24 * 60 * 60;
export const SESSION_RENEW_SECONDS = 24 * 60 * 60;

// Better Auth owns password hashing, sessions and cookies. Its native HTTP handler is deliberately not mounted:
// the app exposes only the /api/session facade, so no signup or alternate token route is reachable.
export function createAuth({ db, client, config }: { db: Db; client: MongoClient; config: AuthConfig }) {
  return betterAuth({
    appName: "NamasteVideo",
    baseURL: config.origin,
    secret: config.secret,
    trustedOrigins: [config.origin],
    database: mongodbAdapter(db, { client }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      autoSignIn: false,
      minPasswordLength: 12,
      maxPasswordLength: 128,
    },
    session: {
      expiresIn: SESSION_MAX_SECONDS,
      updateAge: SESSION_RENEW_SECONDS,
      cookieCache: { enabled: false },
    },
    // Login throttling is enforced by the session facade with MongoDB buckets (rate-limit.ts).
    rateLimit: { enabled: false },
    telemetry: { enabled: false },
    logger: { level: "error" },
    databaseHooks: {
      session: {
        create: {
          // Defense in depth: no session is ever created for an account without enabled internal access.
          before: async (session) => isAdmitted(db, String(session.userId)),
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
export type AuthServices = { db: Db; client: MongoClient; auth: Auth; config: AuthConfig; limits: LoginLimits };

const cache = globalThis as typeof globalThis & { __namasteAuth?: Promise<AuthServices> };

export function getAuthServices(): Promise<AuthServices> {
  cache.__namasteAuth ??= (async () => {
    const config = readAuthConfig();
    const dbConfig = readDatabaseConfig();
    const client = await getMongoClient(dbConfig);
    const db = client.db(dbConfig.dbName);
    return { db, client, config, auth: createAuth({ db, client, config }), limits: DEFAULT_LOGIN_LIMITS };
  })().catch((error) => {
    cache.__namasteAuth = undefined;
    throw error;
  });
  return cache.__namasteAuth;
}
