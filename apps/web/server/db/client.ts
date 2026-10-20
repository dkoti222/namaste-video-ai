import { createHash } from "node:crypto";
import { MongoClient, type Db } from "mongodb";
import { readDatabaseConfig, type DatabaseConfig } from "./config";

// One bounded pool per warm server instance (DB_DESIGN.md section 11); cached on globalThis to survive dev reloads.
type CachedClient = { key: string; client: MongoClient; connected: Promise<MongoClient> };
const cache = globalThis as typeof globalThis & { __namasteMongo?: CachedClient };

export function createMongoClient(config: DatabaseConfig): MongoClient {
  return new MongoClient(config.uri, {
    appName: "namastevideo-web",
    maxPoolSize: config.maxPoolSize,
    serverSelectionTimeoutMS: 10_000,
    retryWrites: true,
    writeConcern: { w: "majority" },
  });
}

export async function getDb(config: DatabaseConfig = readDatabaseConfig()): Promise<Db> {
  return (await getMongoClient(config)).db(config.dbName);
}

export async function getMongoClient(config: DatabaseConfig = readDatabaseConfig()): Promise<MongoClient> {
  const key = createHash("sha256").update(`${config.uri}\n${config.maxPoolSize}`).digest("hex");
  if (cache.__namasteMongo?.key !== key) {
    await cache.__namasteMongo?.client.close().catch(() => undefined);
    const client = createMongoClient(config);
    cache.__namasteMongo = { key, client, connected: client.connect() };
  }
  const entry = cache.__namasteMongo;
  try {
    return await entry.connected;
  } catch (error) {
    if (cache.__namasteMongo === entry) cache.__namasteMongo = undefined;
    await entry.client.close().catch(() => undefined);
    throw error;
  }
}

export async function closeDb(): Promise<void> {
  const entry = cache.__namasteMongo;
  cache.__namasteMongo = undefined;
  await entry?.client.close();
}

export type DeploymentInfo = { version: string; replicaSet: string | null; sharded: boolean; transactions: boolean };

/** Transactions require a replica set or sharded cluster (DB_DESIGN.md section 9). */
export async function describeDeployment(db: Db): Promise<DeploymentInfo> {
  const admin = db.admin();
  const [hello, build] = await Promise.all([admin.command({ hello: 1 }), admin.command({ buildInfo: 1 })]);
  const replicaSet = typeof hello.setName === "string" ? hello.setName : null;
  const sharded = hello.msg === "isdbgrid";
  return {
    version: String(build.version),
    replicaSet,
    sharded,
    transactions: (replicaSet !== null || sharded) && hello.logicalSessionTimeoutMinutes != null,
  };
}
