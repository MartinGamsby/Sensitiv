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

export const DossierSchema = z.object({
  jobId: z.string(),
  status: JobStatusSchema,
  uiLocale: UiLocaleSchema,
  searchLang: z.string(),
  places: z.array(DossierPlaceSchema),
  replayUrls: z.array(z.string()),
  disclaimer: z.string(),
});
export type Dossier = z.infer<typeof DossierSchema>;
