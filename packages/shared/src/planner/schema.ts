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
  /**
   * `"subject"` when this is the KIND OF PLACE the request is for, `"preference"`
   * when it is a property that place should have. Absent is read as a preference,
   * so an older or sloppier reply can only ever under-weight, never over-weight.
   * See `PlannedRequirementSchema.kind` for why the distinction is scored.
   */
  kind: z.enum(["subject", "preference"]).nullish(),
  /**
   * For a `"subject"`, the category vocabulary that tells this kind of place
   * from another. Scoring reads a place's own category against these with no
   * further LLM call, so the model spends one answer here instead of being asked
   * about every place a run finds. Ignored for a preference.
   */
  categoryHints: z
    .object({
      strong: z.array(z.string()).nullish(),
      related: z.array(z.string()).nullish(),
      excluded: z.array(z.string()).nullish(),
    })
    .nullish(),
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
