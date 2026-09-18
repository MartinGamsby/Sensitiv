import { z } from "zod";
import { PlaceDetailSchema, PlaceSourceSchema } from "./place.ts";
import { EvidenceSchema } from "./evidence.ts";
import { ScoreLineSchema } from "./score.ts";
import { PlannedRequirementSchema } from "./requirement.ts";
import { JobStatusSchema } from "./job.ts";
import { UiLocaleSchema } from "./language.ts";

// One ranked place in a dossier. `conflicted` => the UI renders it amber.
export const DossierPlaceSchema = z.object({
  place: PlaceDetailSchema,
  sources: z.array(PlaceSourceSchema),
  evidence: z.array(EvidenceSchema),
  score: z.number(),
  /**
   * Why the score is what it is — one line per rule that fired, summing to
   * `score`. Persisted at run time rather than recomputed on read, so the
   * explanation the dossier shows is the one that actually produced the
   * ranking even if the rubric changes later.
   *
   * Empty on every place scored before the breakdown was stored. The dossier
   * still states the score; it just cannot break it down, which is the honest
   * reading of a row that never recorded one.
   */
  breakdown: z.array(ScoreLineSchema).default([]),
  conflicted: z.boolean(),
});
export type DossierPlace = z.infer<typeof DossierPlaceSchema>;

// One recorded browser session for one adapter. `NULL` in the DB (every
// pre-existing row, and any row this run failed to classify) maps to
// `"unavailable"` — never rendered as a live link.
//
// `"expired"` is distinct from `"unavailable"` on purpose: the recording WAS
// captured and stored, and was then pruned by `REPLAY_RETENTION_DAYS`. "We
// deleted this after N days" and "there was never anything here" are different
// facts about a run and the dossier says which.
export const DossierReplaySchema = z.object({
  id: z.string(),
  adapterId: z.string().optional(),
  status: z.enum([
    "stored",
    "link_only",
    "empty",
    "unavailable",
    "too_large",
    "expired",
  ]),
  findingCount: z.number().int().nonnegative().optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  /** Presigned Solari URL. Still a bearer capability; still scheme-gated in the UI. */
  url: z.string().optional(),
  /** Unix ms. When in the past, the `url` is dead. */
  expiresAt: z.number().int().optional(),
});
export type DossierReplay = z.infer<typeof DossierReplaySchema>;

// Keyed by adapter id (`google_maps`, `yelp`, …) plus the reserved `"llm"`
// key — the actual provider that ran for this job, not an env lookup. A
// pre-existing job with no recorded modes surfaces `{}` (`.default({})`
// below), never a live guess.
//
// Three modes, and the distinction between the first two is the whole point:
//   `live`    — a real provider / a real browser session answered.
//   `fixture` — recorded sample data stood in for a live result. THIS is what
//               the dossier's "contains sample data" strip and the History
//               "Sample data" badge key off, so it must mean exactly that.
//   `stub`    — a `needsBrowser: false` adapter that is not implemented yet
//               (the v1.1 no-ops). It ran and contributed nothing; it did not
//               return canned findings. Folding these into `fixture` would
//               put the sample-data warning on 100% of runs — including
//               perfect live ones — which is the same as having no warning.
export const SourceModeSchema = z.enum(["fixture", "live", "stub"]);
export type SourceMode = z.infer<typeof SourceModeSchema>;

export const DossierSchema = z.object({
  jobId: z.string(),
  status: JobStatusSchema,
  uiLocale: UiLocaleSchema,
  searchLang: z.string(),
  /** What this run was researching, carried so the dossier can offer a
   *  "best for <requirement>" ordering without inventing its own labels. */
  requirements: z.array(PlannedRequirementSchema).default([]),
  /**
   * Where the run actually searched, as the adapter's Maps hop resolved it.
   *
   * The POINT, not a per-place distance. A distance is derived and discards
   * what it was derived from; keeping the centre lets the same dossier be
   * re-measured from anywhere else — a different postal code, or wherever the
   * reader happens to be — without re-running the search.
   */
  searchCenter: z
    .object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) })
    .optional(),
  /**
   * Whether this run asked Solari to record its browser sessions.
   *
   * `undefined` on every job written before the flag existed — those all
   * recorded, but the column cannot say so, and "not recorded" is the honest
   * reading of a NULL everywhere else in this schema. The UI uses it for one
   * thing only: telling "there are no replays because you turned recording
   * off" apart from "there are no replays and something went wrong".
   */
  recordSession: z.boolean().optional(),
  places: z.array(DossierPlaceSchema),
  replays: z.array(DossierReplaySchema),
  disclaimer: z.string(),
  sourceModes: z.record(SourceModeSchema).default({}),
});
export type Dossier = z.infer<typeof DossierSchema>;
