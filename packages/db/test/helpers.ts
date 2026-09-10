import { createDb, type Database } from "../src/client.ts";
import { runMigrations } from "../src/migrate.ts";

/**
 * A freshly migrated, isolated database for a single test. libsql `:memory:`
 * gives every call its own independent in-memory database, so no cleanup is
 * needed — just `close()` when done (optional; the process exit reclaims it).
 */
export async function makeTestDb(): Promise<Database> {
  const database = await createDb(":memory:");
  await runMigrations(database.db);
  return database;
}
