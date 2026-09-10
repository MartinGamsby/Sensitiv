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
