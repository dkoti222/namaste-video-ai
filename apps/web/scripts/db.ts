// Operator database commands. Usage: npm run db:migrate | npm run db:status (from the repository root or apps/web).
import { closeDb, describeDeployment, getDb } from "../server/db/client";
import { readDatabaseConfig, redactConnectionStrings } from "../server/db/config";
import { runMigrations, verifySchema } from "../server/db/migrations";

async function main(command: string | undefined): Promise<number> {
  if (command !== "migrate" && command !== "status") {
    console.error("Usage: db.ts migrate|status");
    return 2;
  }
  const config = readDatabaseConfig(process.env, command === "migrate" ? "migration" : "app");
  console.log(`Database: ${config.dbName} (URI from ${config.uriSource})`);
  if (command === "migrate" && config.uriSource === "MONGODB_URI") {
    console.log("Note: using the application credential for migration. Use a separate MONGODB_MIGRATION_URI outside local development.");
  }

  const db = await getDb(config);
  const deployment = await describeDeployment(db);
  console.log(
    `MongoDB ${deployment.version}; ${deployment.replicaSet ? `replica set ${deployment.replicaSet}` : deployment.sharded ? "sharded cluster" : "standalone"}; transactions ${deployment.transactions ? "available" : "unavailable"}`,
  );
  if (!deployment.transactions) {
    console.error("Transactions are required. Use an Atlas cluster or a local replica set.");
    return 1;
  }

  if (command === "migrate") {
    for (const { name, outcome } of await runMigrations(db)) console.log(`${name}: ${outcome.replace("_", " ")}`);
  }

  const report = await verifySchema(db);
  for (const problem of report.problems) console.error(`Problem: ${problem}`);
  for (const index of report.unexpectedIndexes) console.log(`Unlisted index (not created by migrations): ${index}`);
  console.log(report.ok ? "Schema matches the catalog." : "Schema does not match the catalog.");
  return report.ok ? 0 : 1;
}

main(process.argv[2])
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    console.error(redactConnectionStrings(message));
    process.exitCode = 1;
  })
  .finally(() => closeDb());
