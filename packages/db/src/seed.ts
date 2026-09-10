import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { createDb } from "./client.ts";
import { runMigrations } from "./migrate.ts";
import { getOrCreateLocalUser } from "./users.ts";

/**
 * Idempotent v1 seed: ensure the schema is migrated, then create the single
 * local user. Running it twice must not throw or duplicate. Nothing else is
 * seeded in v1.
 */
export async function seed(): Promise<void> {
  const { db, client, url } = await createDb();
  try {
    await runMigrations(db);
    const user = await getOrCreateLocalUser(db);
    console.log(`db:seed — database ${url}`);
    console.log(`db:seed — local user ${user.email} (id ${user.id})`);
  } finally {
    client.close();
  }
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (invokedDirectly) {
  seed().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
