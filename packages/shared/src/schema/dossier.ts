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

export const DossierSchema = z.object({
  jobId: z.string(),
  status: JobStatusSchema,
  uiLocale: UiLocaleSchema,
  searchLang: z.string(),
  places: z.array(DossierPlaceSchema),
  replays: z.array(DossierReplaySchema),
  disclaimer: z.string(),
});
export type Dossier = z.infer<typeof DossierSchema>;
