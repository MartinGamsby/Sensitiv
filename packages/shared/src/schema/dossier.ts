import { z } from "zod";
import { PlaceDetailSchema, PlaceSourceSchema } from "./place.ts";
import { EvidenceSchema } from "./evidence.ts";
import { JobStatusSchema } from "./job.ts";
import { UiLocaleSchema } from "./language.ts";

// One ranked place in a dossier. `conflicted` => the UI renders it amber.
export const DossierPlaceSchema = z.object({
  place: PlaceDetailSchema,
  sources: z.array(PlaceSourceSchema),
  evidence: z.array(EvidenceSchema),
  score: z.number(),
  conflicted: z.boolean(),
});
export type DossierPlace = z.infer<typeof DossierPlaceSchema>;

// One recorded browser session for one adapter. `NULL` in the DB (every
// pre-existing row, and any row this run failed to classify) maps to
// `"unavailable"` — never rendered as a live link.
export const DossierReplaySchema = z.object({
  id: z.string(),
  adapterId: z.string().optional(),
  status: z.enum(["stored", "link_only", "empty", "unavailable", "too_large"]),
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
  places: z.array(DossierPlaceSchema),
  replays: z.array(DossierReplaySchema),
  disclaimer: z.string(),
  sourceModes: z.record(SourceModeSchema).default({}),
});
export type Dossier = z.infer<typeof DossierSchema>;
