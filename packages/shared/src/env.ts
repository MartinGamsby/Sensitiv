// SERVER / WORKER ONLY. This module reads process.env and holds every secret in
// the app. It must NEVER be imported from a client component or shipped in a
// browser bundle. `redactEnv()` is the only shape allowed near a logger.
import { existsSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { z } from "zod";

const twoLowerLetters = z
  .string()
  .transform((s) => s.trim().toLowerCase())
  .pipe(z.string().regex(/^[a-z]{2}$/, "must be two ISO 3166-1 alpha-2 letters"));

// Every key is optional in v1: an empty .env must load. Only MALFORMED values
// throw (WORKER_PORT=abc, SOLARI_PROXY_COUNTRY=canada).
const EnvSchema = z.object({
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  LLM_PROVIDER: z.string().min(1).default("anthropic"),
  SOLARI_API_KEY: z.string().min(1).optional(),
  SOLARI_PROXY_COUNTRY: twoLowerLetters.default("ca"),
  DATABASE_URL: z.string().min(1).default("file:./data/sensitiv.db"),
  WORKER_URL: z.string().min(1).default("http://127.0.0.1:8787"),
  WORKER_PORT: z.coerce.number().int().positive().default(8787),
  DEFAULT_JOB_TIMEOUT_SEC: z.coerce.number().int().positive().default(480),
  /**
   * How long a downloaded session replay is kept on disk, in days.
   *
   * `0` means FOREVER, and is the DEFAULT. Two reasons, and the second is the
   * stronger one:
   *   - a stale recording is still perfectly good for re-reading what the agent
   *     saw, so losing one to a retention sweep mid-investigation costs more
   *     than the disk it saves;
   *   - a default that deletes data is a default that deletes data the user
   *     already has, the first time they restart the worker after an upgrade.
   *     Retention is a decision to opt IN to, not out of.
   *
   * Set a positive number to bound it. Worth bounding on a machine that runs a
   * lot of recorded jobs: real runs in this repo produced 1.6-19 MB each, and
   * they hold the search URLs, which encode the user's requirements (see
   * memory/security-invariants.md). Recording is itself opt-in per run, so
   * growth only happens when it was asked for.
   *
   * `nonnegative`, not `positive`, precisely so `0` is expressible.
   */
  REPLAY_RETENTION_DAYS: z.coerce.number().int().nonnegative().default(0),

  /**
   * How long an extracted place may be reused from the extraction cache,
   * in hours. `0` disables the cache entirely.
   *
   * The default is 24 hours, and the direction is deliberately the OPPOSITE of
   * `REPLAY_RETENTION_DAYS` above, which defaults to "keep forever":
   *
   *   - a replay is a recording of what the agent SAW. It ages into history,
   *     not into a lie, so deleting it is the destructive act and the safe
   *     default is to keep it.
   *   - a cached extraction is a CLAIM ABOUT THE WORLD — "this kitchen is
   *     entirely gluten-free". Serving one that outlived a renovation, a change
   *     of owner or a closure presents stale evidence as fresh research, which
   *     is the precise failure this whole app exists to avoid. Here the
   *     unbounded option is the destructive one, so the cache always expires.
   *
   * 24 hours covers the loop this exists for — run a search, adjust the
   * requirements, run it again — without letting a claim survive long enough
   * for the place to have changed underneath it.
   *
   * `nonnegative`, not `positive`, precisely so `0` is expressible.
   */
  EXTRACTION_CACHE_TTL_HOURS: z.coerce.number().int().nonnegative().default(24),
});

export type Env = Readonly<z.infer<typeof EnvSchema>>;

/**
 * Walk up from `startDir` for `pnpm-workspace.yaml` — the monorepo root.
 * Duplicated from `packages/db/src/client.ts` (same shape) rather than shared,
 * to keep `@sensitiv/shared` free of a dependency on `@sensitiv/db`.
 */
function findRepoRoot(startDir: string = process.cwd()): string {
  let dir = resolvePath(startDir);
  while (true) {
    if (existsSync(resolvePath(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Fallback: this file lives at packages/shared/src/env.ts.
  return fileURLToPath(new URL("../../../", import.meta.url));
}

/**
 * Load the monorepo-root `.env` into `process.env`. Neither of our two
 * processes does this on its own: the worker is a plain `tsx` process (no
 * dotenv), and Next.js only auto-loads `.env*` from `apps/web/`, not the repo
 * root — so a `SOLARI_API_KEY` in the root `.env` (per the README / quick
 * start) was silently invisible to both. Call this ONCE, as the very first
 * thing, at every process entrypoint (`apps/worker/src/index.ts`,
 * `apps/web/next.config.ts`) — before any other module reads `process.env`.
 *
 * Never overrides a variable already present in `process.env` (dotenv's
 * default), so a real shell/CI env still wins over the file. A missing `.env`
 * is not an error — `.env` is optional everywhere in this app.
 */
export function loadDotEnvFile(repoRoot: string = findRepoRoot()): void {
  const path = resolvePath(repoRoot, ".env");
  if (!existsSync(path)) return;
  dotenv.config({ path });
}

/**
 * Validate `process.env` (or a supplied record) and return a frozen typed object.
 * Throws a ZodError on malformed values; an empty environment loads fine.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  // Treat "" the same as unset so a scaffolded .env.example with empty values loads.
  const cleaned: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === "string" && value.trim() !== "") cleaned[key] = value;
  }
  return Object.freeze(EnvSchema.parse(cleaned));
}

type RedactedEnv = Omit<Env, "ANTHROPIC_API_KEY" | "SOLARI_API_KEY"> & {
  ANTHROPIC_API_KEY: "<set>" | "<unset>";
  SOLARI_API_KEY: "<set>" | "<unset>";
};

/**
 * The only representation of the env allowed near a logger: every `*_KEY` is
 * replaced by "<set>" / "<unset>" so no secret value can be serialized.
 */
export function redactEnv(env: Env): RedactedEnv {
  const mark = (v: string | undefined): "<set>" | "<unset>" =>
    v ? "<set>" : "<unset>";
  const { ANTHROPIC_API_KEY, SOLARI_API_KEY, ...rest } = env;
  return {
    ...rest,
    ANTHROPIC_API_KEY: mark(ANTHROPIC_API_KEY),
    SOLARI_API_KEY: mark(SOLARI_API_KEY),
  };
}

export function hasSolariKey(env: Env): boolean {
  return Boolean(env.SOLARI_API_KEY);
}

export function hasAnthropicKey(env: Env): boolean {
  return Boolean(env.ANTHROPIC_API_KEY);
}
