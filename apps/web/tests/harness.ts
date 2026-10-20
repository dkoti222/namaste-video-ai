// Shared integration harness: replica set, migrations, Better Auth, signed-in users and route-handler requests.
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { MongoClient, type Db } from "mongodb";
import { createAuth, type AuthServices } from "../server/auth/auth";
import { provisionUser } from "../server/auth/provisioning";
import { DEFAULT_LOGIN_LIMITS } from "../server/auth/rate-limit";
import { signIn } from "../server/auth/session";
import { runMigrations } from "../server/db/migrations";
import { handle } from "../server/http";

export const ORIGIN = "http://127.0.0.1:3000";
const PASSWORD = "correct horse battery";

export type Harness = {
  db: Db;
  services: AuthServices;
  users: Record<string, { id: string; cookie: string }>;
  request: (method: string, path: string, options?: { user?: string; body?: unknown; key?: string; origin?: string | null }) => Request;
  stop: () => Promise<void>;
};

export async function startHarness(name: string, userNames: string[]): Promise<Harness> {
  process.env.MEDIA_ORIGIN_FILE = ""; // never pick up a locally running media tunnel
  const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  const client = await new MongoClient(replSet.getUri()).connect();
  const db = client.db(`${name}_${process.pid}`);
  await runMigrations(db);
  const config = { secret: "test-secret-".padEnd(48, "x"), origin: ORIGIN };
  const services: AuthServices = { db, client, config, auth: createAuth({ db, client, config }), limits: DEFAULT_LOGIN_LIMITS };
  // Route handlers resolve services through getAuthServices(); point its cache at the test services.
  (globalThis as { __namasteAuth?: Promise<AuthServices> }).__namasteAuth = Promise.resolve(services);

  const users: Harness["users"] = {};
  for (const [index, user] of userNames.entries()) {
    const { userId } = await provisionUser(services, { email: `${user}@example.com`, password: PASSWORD, operatorRef: "test" });
    const response = await handle((id) =>
      signIn(
        new Request(`${ORIGIN}/api/session/sign-in`, {
          method: "POST",
          headers: { origin: ORIGIN, "content-type": "application/json", "x-forwarded-for": `198.51.100.${index + 1}` },
          body: JSON.stringify({ email: `${user}@example.com`, password: PASSWORD }),
        }),
        services,
        id,
      ),
    );
    users[user] = { id: userId, cookie: response.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ") };
  }

  const request: Harness["request"] = (method, path, { user = userNames[0], body, key, origin } = {}) => {
    const headers = new Headers({ cookie: users[user].cookie });
    if (origin !== null && method !== "GET") headers.set("origin", origin ?? ORIGIN);
    if (body !== undefined) headers.set("content-type", "application/json");
    if (key) headers.set("idempotency-key", key);
    return new Request(`${ORIGIN}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  };

  return {
    db,
    services,
    users,
    request,
    stop: async () => {
      await client.close();
      await replSet.stop();
    },
  };
}

export const params = (id: string) => ({ params: Promise.resolve({ id }) });
export const json = async (response: Response) => ({ status: response.status, body: await response.json(), headers: response.headers });
