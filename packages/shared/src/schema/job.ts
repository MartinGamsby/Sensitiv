import { z } from "zod";
import { LocationSchema } from "./location.ts";
import { UiLocaleSchema } from "./language.ts";
import { JobProgressSchema } from "./progress.ts";

export const JobStatusSchema = z.enum([
  "queued",
  "running",
  "done",
  "partial",
  "error",
]);
export type JobStatus = z.infer<typeof JobStatusSchema>;

export const DEFAULT_JOB_TIMEOUT_SEC = 480;
export const MIN_JOB_TIMEOUT_SEC = 60;
export const MAX_JOB_TIMEOUT_SEC = 1800;

const jobCreateShape = {
  location: LocationSchema,
  requestText: z.string(),
  chipIds: z.array(z.string()), // catalog requirement ids selected in the UI; [] = free-text-only run
  /**
   * Per chip, WHERE the user said to look — a subset of that chip's catalog
   * `intents`, picked in the chip's own sub-control. Keyed by chip id.
   *
   * Optional, and an absent or empty entry falls back to `defaultIntentsFor`
   * (the chip's FIRST intent), never to all of them. A celiac chip means
   * "somewhere I can eat" unless the user also ticks groceries; it used to mean
   * both, which is how a search for a Mexican restaurant also searched for
   * grocery stores.
   */
  chipIntents: z.record(z.string(), z.array(z.string())).optional(),
  allergens: z.array(z.string()).optional(),
  diet: z.string().optional(),
  searchLang: z.string().nullish(), // null/undefined = auto
  uiLocale: UiLocaleSchema,
  timeoutSec: z
    .number()
    .int()
    .min(MIN_JOB_TIMEOUT_SEC)
    .max(MAX_JOB_TIMEOUT_SEC)
    .default(DEFAULT_JOB_TIMEOUT_SEC),
  // Search DEPTH, default ON (quick). Google Maps renders roughly the first
  // eight results and lazy-loads the rest only when the results feed is
  // scrolled; a quick search reads what the first screen already has and skips
  // the scroll loop entirely. That is ~8 places instead of ~22, and it removes
  // both the scroll rounds and the per-place enrichment they would have fed.
  // Unticking it restores the exhaustive pass. Persisted for the same reason
  // `recordSession` is: the worker's poll loop never sees the HTTP body.
  quickSearch: z.boolean().default(true),
  // Opt-in, default OFF. A Solari recording captures the pages the agent
  // visited, and the search URLs it visited encode the user's requirements —
  // celiac, an allergen list, wheelchair access, mould. That is health,
  // accessibility and housing data, and leaving it with a third party has to be
  // a choice the user makes per run, not a default they never saw. Unlike
  // `solariKey` this IS persisted: the worker poll loop can claim a job without
  // ever seeing the HTTP body, so the flag has to live on the row.
  recordSession: z.boolean().default(false),
  // BYOK, session-only. TRANSPORT-ONLY: never write this to a DB row, a log line,
  // or replay metadata (enforced in Sections 7 and 8).
  solariKey: z.string().optional(),
};

// Lenient variant — unknown keys are passed through untouched.
export const JobCreateInputSchema = z.object(jobCreateShape).passthrough();

// Strict variant used by the API: unknown keys are stripped from the result.
export const JobCreateInputStrictSchema = z.object(jobCreateShape).strip();

export type JobCreateInput = z.infer<typeof JobCreateInputSchema>;
export type JobCreateInputRaw = z.input<typeof JobCreateInputSchema>;

export const JobEventSchema = z.object({
  id: z.number().int(),
  jobId: z.string(),
  ts: z.string(),
  level: z.enum(["debug", "info", "warn", "error"]),
  message: z.string(),
  source: z.string().optional(),
  // Present only on the handful of rows the worker tags as phase markers. The
  // run page's progress bar reads these and nothing else — never the message
  // text, which is free-form prose in the UI locale.
  progress: JobProgressSchema.optional(),
});
export type JobEvent = z.infer<typeof JobEventSchema>;
