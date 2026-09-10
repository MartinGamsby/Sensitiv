import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { migrate } from "drizzle-orm/libsql/migrator";
import { createDb, type DbHandle } from "./client.ts";

const MIGRATIONS_FOLDER = fileURLToPath(new URL("../migrations", import.meta.url));

/** Apply every checked-in migration. Idempotent — a second run is a no-op. */
export async function runMigrations(db: DbHandle): Promise<void> {
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
}

async function main(): Promise<void> {
  const { db, client, url } = await createDb();
  try {
    await runMigrations(db);
    console.log(`db:migrate — applied migrations against ${url}`);
  } finally {
    client.close();
  }
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (invokedDirectly) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
