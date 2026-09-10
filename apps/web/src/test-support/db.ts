// TEST SUPPORT (not a route). A freshly-migrated in-memory libsql database for a
// single test file. libsql `:memory:` is independent per connection, so no
// cleanup beyond `close()` is needed.
import { createDb, runMigrations, type Database } from "@sensitiv/db";

export async function makeTestDb(): Promise<Database> {
  const database = await createDb(":memory:");
  await runMigrations(database.db);
  return database;
}
