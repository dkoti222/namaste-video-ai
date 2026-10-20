// Server-only database configuration. Values come from apps/web/.env.local or the hosting secret store.

export class DatabaseConfigError extends Error {
  override name = "DatabaseConfigError";
}

export type DatabasePurpose = "app" | "migration";

export type DatabaseConfig = {
  uri: string;
  dbName: string;
  maxPoolSize: number;
  /** Environment variable that supplied the URI; never the URI itself. */
  uriSource: "MONGODB_URI" | "MONGODB_MIGRATION_URI";
};

const RESERVED_DATABASES = new Set(["admin", "local", "config"]);
const DB_NAME_PATTERN = /^[A-Za-z0-9_-]{1,38}$/;

type Env = Record<string, string | undefined>;

export function readDatabaseConfig(env: Env = process.env, purpose: DatabasePurpose = "app"): DatabaseConfig {
  const migrationUri = purpose === "migration" ? env.MONGODB_MIGRATION_URI?.trim() : undefined;
  const uriSource = migrationUri ? "MONGODB_MIGRATION_URI" : "MONGODB_URI";
  const uri = migrationUri || env.MONGODB_URI?.trim();
  if (!uri) {
    throw new DatabaseConfigError(
      purpose === "migration"
        ? "Database is not configured: set MONGODB_MIGRATION_URI (preferred) or MONGODB_URI in apps/web/.env.local."
        : "Database is not configured: set MONGODB_URI in apps/web/.env.local.",
    );
  }
  if (!/^mongodb(\+srv)?:\/\//.test(uri)) {
    throw new DatabaseConfigError(`${uriSource} must start with mongodb:// or mongodb+srv://.`);
  }

  const dbName = env.MONGODB_DB_NAME?.trim();
  if (!dbName) {
    throw new DatabaseConfigError("Database is not configured: set MONGODB_DB_NAME to an isolated database name, e.g. namastevideo_dev.");
  }
  if (!DB_NAME_PATTERN.test(dbName) || RESERVED_DATABASES.has(dbName.toLowerCase())) {
    throw new DatabaseConfigError("MONGODB_DB_NAME must be 1-38 letters, digits, '_' or '-' and must not be admin, local or config.");
  }

  const rawPool = env.MONGODB_MAX_POOL_SIZE?.trim();
  const maxPoolSize = rawPool ? Number(rawPool) : 10;
  if (!Number.isInteger(maxPoolSize) || maxPoolSize < 1 || maxPoolSize > 100) {
    throw new DatabaseConfigError("MONGODB_MAX_POOL_SIZE must be an integer from 1 to 100.");
  }

  return { uri, dbName, maxPoolSize, uriSource };
}

/** Removes connection strings from text before it is logged or shown. */
export function redactConnectionStrings(text: string): string {
  return text.replace(/mongodb(\+srv)?:\/\/[^\s'"`]+/g, "mongodb://[redacted]");
}
