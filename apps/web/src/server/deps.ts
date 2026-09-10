// The single seam every route handler pulls its side-effecting dependencies
// from: the SQLite handle, the validated env, and `fetch`. Production code calls
// `getWebDeps()` with no argument; tests call `__setWebDeps()` first to inject an
// in-memory database, a fake env, and a stubbed `fetch`.
//
// SERVER ONLY — imports `@sensitiv/shared/env`, which holds every secret and must
// never reach a client bundle.
import { getDb, type DbHandle } from "@sensitiv/db";
import { loadEnv, type Env } from "@sensitiv/shared/env";

export interface WebDeps {
  db: DbHandle;
  env: Env;
  fetch: typeof fetch;
}

let testOverride: Partial<WebDeps> | undefined;

/**
 * TEST ONLY. Inject any subset of the deps; pass `undefined` to restore the real
 * ones. Never call this from production code.
 */
export function __setWebDeps(override: Partial<WebDeps> | undefined): void {
  testOverride = override;
}

export async function getWebDeps(): Promise<WebDeps> {
  const db = testOverride?.db ?? (await getDb()).db;
  const env = testOverride?.env ?? loadEnv();
  const fetchImpl = testOverride?.fetch ?? globalThis.fetch.bind(globalThis);
  return { db, env, fetch: fetchImpl };
}
