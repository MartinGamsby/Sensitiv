import { z } from "zod";
import { DEFAULT_REQUIREMENT_WEIGHT } from "../../catalog/requirements.ts";

// A requirement the planner decided to research. `id` and `intentIds` are PLAIN
// STRINGS on purpose — they are validated against the config-driven catalog at
// runtime (Section 3), never modelled as a TS union. This is the single most
// important constraint in the codebase: business logic must look ids up, not
// switch on them.
export const PlannedRequirementSchema = z.object({
  id: z.string().min(1), // catalog id OR "custom_<slug>"
  catalogId: z.string().min(1).optional(), // set when derived from the catalog
  label: z.string().min(1), // display text in the UI locale
  intentIds: z.array(z.string().min(1)), // MUST be valid catalog intent ids
  must: z.array(z.string()),
  nice: z.array(z.string()),
  allergens: z.array(z.string()).optional(),
  diet: z.string().optional(),
  /** Scoring multiplier, carried from the catalog (see `CatalogRequirement.weight`).
   *  Defaults to the ad-hoc tier so a `custom_<slug>` requirement the planner
   *  invented never outranks a chip the user deliberately picked. */
  weight: z.number().positive().default(DEFAULT_REQUIREMENT_WEIGHT),
  /** Catalog `satisfiedByHints`, carried through to the extraction prompt so
   *  the model stops marking an all-gluten-free venue `unclear` for lacking a
   *  "dedicated gluten-free kitchen". */
  satisfiedBy: z.array(z.string()).default([]),
});

export type PlannedRequirement = z.infer<typeof PlannedRequirementSchema>;
