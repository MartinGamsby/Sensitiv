import { defineConfig } from "drizzle-kit";

// `drizzle-kit generate` only reads the schema to emit migration SQL — it needs
// no live connection. Generated SQL under ./migrations is COMMITTED; never run
// `drizzle-kit push` in dev or the checked-in migrations drift from the schema.
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/schema.ts",
  out: "./migrations",
  strict: true,
  verbose: true,
});
