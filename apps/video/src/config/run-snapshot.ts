import { z } from "zod";

// A finished research run, frozen into plain JSON for the video to replay.
//
// Written by `scripts/import-run.ts` from a real row in `data/sensitiv.db`, and
// committed next to the scenario that uses it, so a fresh clone can render
// the video without anyone's local database. Every field is something the run
// actually produced — the video restyles it, it never invents it. Edit it by
// hand if you must (a shorter address, a trimmed quote), but a re-import
// overwrites the file.

const PointSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export const SnapshotEvidenceSchema = z.object({
  requirementId: z.string(),
  polarity: z.enum(["supports", "contradicts", "unclear"]),
  /** The extractor's one-sentence reading of the quote. */
  claim: z.string(),
  /** Verbatim from the source. Empty for "nothing was found". */
  quote: z.string(),
  /** Adapter id: `google_maps`, `openstreetmap`, … */
  source: z.string(),
  date: z.string().optional(),
  confidence: z.number().min(0).max(1),
});
export type SnapshotEvidence = z.infer<typeof SnapshotEvidenceSchema>;

export const SnapshotLineSchema = z.object({
  /** Empty for `proximity`, which is about the place, not a requirement. */
  requirementId: z.string(),
  rule: z.string(),
  delta: z.number(),
  weight: z.number(),
  viaCategory: z.boolean().optional(),
  discounted: z.boolean().optional(),
});
export type SnapshotLine = z.infer<typeof SnapshotLineSchema>;

export const SnapshotPlaceSchema = z.object({
  name: z.string().min(1),
  address: z.string().optional(),
  category: z.string().optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  /**
   * A photo of the place: an https URL (downloaded by `pnpm video:assets`) or
   * a path under `apps/video/public/`. Absent means the initials tile, exactly
   * like the app. The scenario's `images.photos` overrides this per place.
   */
  photo: z.string().optional(),
  score: z.number(),
  conflicted: z.boolean(),
  breakdown: z.array(SnapshotLineSchema),
  evidence: z.array(SnapshotEvidenceSchema),
  sources: z.array(
    z.object({
      source: z.string(),
      rating: z.number().optional(),
      reviewCount: z.number().int().nonnegative().optional(),
    }),
  ),
});
export type SnapshotPlace = z.infer<typeof SnapshotPlaceSchema>;

export const SnapshotProgressSchema = z.object({
  phase: z.enum(["start", "plan", "sources", "merge", "dossier"]),
  done: z.number().int().min(0).optional(),
  total: z.number().int().min(0).optional(),
  unit: z.enum(["source", "query", "place"]).optional(),
  within: z.number().min(0).max(1).optional(),
});

export const SnapshotEventSchema = z.object({
  /** Seconds since the run's first event. */
  t: z.number().min(0),
  level: z.string(),
  message: z.string(),
  progress: SnapshotProgressSchema.optional(),
});
export type SnapshotEvent = z.infer<typeof SnapshotEventSchema>;

export const RunSnapshotSchema = z.object({
  jobId: z.string().min(1),
  importedAt: z.string(),
  status: z.enum(["done", "partial"]),
  /** When the run was started, ISO 8601. */
  createdAt: z.string(),
  durationSec: z.number().min(0),
  request: z.string(),
  location: z.object({
    query: z.string(),
    lat: z.number().optional(),
    lng: z.number().optional(),
    radiusKm: z.number().positive(),
    pinned: z.boolean(),
  }),
  searchCenter: PointSchema.optional(),
  searchLang: z.string(),
  /** What the run was scored against, heaviest first as the planner left it. */
  requirements: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      weight: z.number(),
      kind: z.enum(["subject", "preference"]).optional(),
    }),
  ),
  intents: z.array(z.string()),
  /** Per source, what actually ran. Only `live` runs import by default. */
  sourceModes: z.record(z.string()),
  quickSearch: z.boolean().optional(),
  /** The run's yardstick: the best score any place could have earned. */
  maxScore: z.number().min(0),
  /** Ranked, best first — the dossier's own order. */
  places: z.array(SnapshotPlaceSchema).min(1),
  /** The activity log, minus plumbing (progress ticks, session ids). */
  log: z.array(SnapshotEventSchema),
});
export type RunSnapshot = z.infer<typeof RunSnapshotSchema>;
