import { existsSync, mkdirSync } from "node:fs";
import { dirname, isAbsolute, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "@sensitiv/shared/env";
import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import * as tables from "./schema.ts";

export type DbHandle = LibSQLDatabase<typeof tables>;

export interface Database {
  db: DbHandle;
  client: Client;
  /** The fully-resolved libsql URL actually opened. */
  url: string;
}

/**
 * Walk up from `startDir` looking for `pnpm-workspace.yaml`. Relative `file:`
 * DB paths MUST resolve against this, not `process.cwd()` — the Next server
 * (cwd `apps/web`) and the worker (cwd `apps/worker`) open the same database.
 */
export function findRepoRoot(startDir: string = process.cwd()): string {
  let dir = resolve(startDir);
  while (true) {
    if (existsSync(resolve(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Fallback: this file lives at packages/db/src/client.ts.
  return fileURLToPath(new URL("../../../", import.meta.url));
}

/**
 * Absolute path of the stored-replay root, `<repo>/data/replays`. `data/` is the
 * second filesystem contract the worker (which writes recordings) and the Next
 * server (which serves them back) share, alongside the SQLite file itself — so
 * it is resolved here, the one module both already depend on for `findRepoRoot`.
 */
export function replaysRoot(repoRoot: string = findRepoRoot()): string {
  return resolve(repoRoot, "data", "replays");
}

/**
 * Resolve a `replays.stored_path` value to an absolute path, asserting it stays
 * under `data/replays/`; `undefined` when it escapes. `stored_path` is always
 * ours (written by the worker from a job id + a session id, never from request
 * input) — this is defence in depth, and it lives here rather than in either app
 * so the writer and the download route share ONE implementation of the
 * containment check instead of two that can drift.
 * See `memory/security-invariants.md`.
 */
export function resolveStoredReplayPath(
  relativePath: string,
  repoRoot: string = findRepoRoot(),
): string | undefined {
  const root = replaysRoot(repoRoot);
  const abs = resolve(repoRoot, relativePath);
  if (abs !== root && !abs.startsWith(root + sep)) return undefined;
  return abs;
}

/**
 * Turn a raw `DATABASE_URL` into a libsql URL. `:memory:` and remote URLs pass
 * through untouched; a relative `file:` path is resolved against the repo root
 * so every process opens the same file regardless of its cwd.
 */
export function resolveDatabaseUrl(
  rawUrl: string,
  repoRoot: string = findRepoRoot(),
): string {
  if (!rawUrl.startsWith("file:")) return rawUrl;
  let filePath = rawUrl.slice("file:".length);
  if (filePath.startsWith("//")) filePath = filePath.slice(2);
  if (filePath === ":memory:") return ":memory:";
  if (isAbsolute(filePath)) return `file:${filePath}`;
  return `file:${resolve(repoRoot, filePath)}`;
}

/**
 * Open a fresh database + drizzle handle. Tests use this factory directly with
 * `":memory:"`; app code uses the `getDb()` singleton.
 */
export async function createDb(rawUrl?: string): Promise<Database> {
  const source = rawUrl ?? loadEnv().DATABASE_URL;
  const url = resolveDatabaseUrl(source);

  if (url.startsWith("file:")) {
    const filePath = url.slice("file:".length);
    const dir = dirname(filePath);
    if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  const client = createClient({ url });

  // The worker and the web server both write; keep them from tripping over each
  // other. WAL only applies to on-disk databases.
  if (url.startsWith("file:")) {
    await client.execute("PRAGMA journal_mode = WAL;");
  }
  await client.execute("PRAGMA busy_timeout = 5000;");
  // SQLite has foreign keys OFF by default.
  await client.execute("PRAGMA foreign_keys = ON;");

  const db = drizzle(client, { schema: tables });
  return { db, client, url };
}

let singleton: Promise<Database> | undefined;

/** Process-wide singleton database handle, opened from `DATABASE_URL`. */
export function getDb(): Promise<Database> {
  singleton ??= createDb();
  return singleton;
}
