// SERVER / WORKER ONLY. This module reads process.env and holds every secret in
// the app. It must NEVER be imported from a client component or shipped in a
// browser bundle. `redactEnv()` is the only shape allowed near a logger.
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
});

export type Env = Readonly<z.infer<typeof EnvSchema>>;

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
