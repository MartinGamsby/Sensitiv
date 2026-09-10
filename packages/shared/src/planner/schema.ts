import { z } from "zod";

// The RAW shape we ask the LLM to return. It is deliberately permissive: the
// model WILL invent intent ids and catalog ids, and `plan()` filters every one
// of them through the catalog allowlist afterwards. Nothing here is trusted for
// control flow — it is just strings until the catalog says otherwise.
export const PlannerLlmRequirementSchema = z.object({
  /** A catalog requirement id when the text matches one; null/omitted otherwise. */
  catalogId: z.string().min(1).nullish(),
  /** Short human label — used as-is for a custom requirement, ignored for catalog ones. */
  label: z.string().min(1),
  /** Catalog intent ids. Validated in `plan()`; unknowns are dropped + logged. */
  intentIds: z.array(z.string().min(1)),
  /** Extra "must have" hints, phrased in the search language. */
  must: z.array(z.string()),
  /** Extra "nice to have" hints, phrased in the search language. */
  nice: z.array(z.string()),
  /** Allergen ids the text names (only meaningful for allergen requirements). */
  allergens: z.array(z.string()).nullish(),
  /** Diet id the text names (only meaningful for diet requirements). */
  diet: z.string().min(1).nullish(),
});
export type PlannerLlmRequirement = z.infer<typeof PlannerLlmRequirementSchema>;

export const PlannerLlmOutputSchema = z.object({
  /** Requirements the free text implies BEYOND the chips already selected. */
  requirements: z.array(PlannerLlmRequirementSchema),
  /** Free-form reasoning notes — recorded, never acted on. */
  notes: z.string().nullish(),
});
export type PlannerLlmOutput = z.infer<typeof PlannerLlmOutputSchema>;
