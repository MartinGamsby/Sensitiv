import { z } from "zod";

export const EvidencePolaritySchema = z.enum([
  "supports",
  "contradicts",
  "unclear",
]);
export type EvidencePolarity = z.infer<typeof EvidencePolaritySchema>;

// A single quoted claim tying a place to a requirement. The quote stays in the
// SOURCE language, verbatim. `confidence` is clamped to 0..1 rather than
// rejected — LLMs happily return 95 when they mean 0.95.
export const EvidenceSchema = z.object({
  requirementId: z.string().min(1),
  claim: z.string().min(1),
  polarity: EvidencePolaritySchema,
  quote: z.string(),
  source: z.string().min(1),
  sourceUrl: z.string(),
  date: z.string().optional(), // ISO date if the source gives one
  confidence: z
    .number()
    .transform((n) => (n > 1 ? n / 100 : n))
    .transform((n) => Math.min(1, Math.max(0, n))),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

/**
 * How strongly a body of evidence settles ONE requirement, before any
 * weighting: positive when supported, negative when contradicted, `0` when
 * nothing settled it either way.
 *
 * This is the un-weighted core of the worker's per-requirement scoring rule,
 * lifted into shared so the dossier's "most gluten-free first" ordering and the
 * score that ranks the dossier by default cannot drift apart. The worker adds
 * the requirement's weight, the corroboration bonus and the explainable
 * breakdown on top; the UI only needs the ordering.
 *
 * Magnitude comes from the extractor's own confidence, so "categorised as a
 * gluten-free restaurant" (0.95) sorts above "one review mentions it" (0.55)
 * rather than tying with it.
 */
export function requirementStanding(
  evidence: readonly Evidence[],
  requirementId: string,
): number {
  let standing = 0;
  let bestSupport = -1;
  let worstContradiction = -1;
  for (const item of evidence) {
    if (item.requirementId !== requirementId) continue;
    if (item.polarity === "supports") {
      bestSupport = Math.max(bestSupport, item.confidence);
    } else if (item.polarity === "contradicts") {
      worstContradiction = Math.max(worstContradiction, item.confidence);
    }
  }
  if (bestSupport >= 0) standing += 1 + bestSupport;
  if (worstContradiction >= 0) standing -= 1 + worstContradiction;
  return standing;
}
