import { z } from "zod";
import type { PlannedRequirement } from "./requirement.ts";

// The shape of a score, shared so the worker that COMPUTES one and the dossier
// that EXPLAINS one cannot drift apart — the same reason `requirementStanding`
// lives beside `Evidence` rather than in the worker.
//
// The rubric itself (which rule fires when, and for how much) stays in
// `apps/worker/src/score.ts`. What lives here is the vocabulary, the two
// constants that bound a score, and the arithmetic that turns an unbounded sum
// into a number a reader can place: a percentage of the best a place could
// possibly have done on THIS run's requirements.

export const ScoreRuleSchema = z.enum([
  "explicit",
  "supported",
  "corroborated",
  "contradicted",
  "unverified",
  // The two grades between "we confirmed it" and "we know it is wrong", for a
  // `kind: "subject"` requirement judged against the place's OWN category:
  // `related` is an adjacent kind of place (a Venezuelan restaurant on a search
  // for a Mexican one), `mismatched` is a different kind entirely (a dessert
  // shop). See `categoryStanding`.
  "related",
  "mismatched",
  "proximity",
]);
export type ScoreRule = z.infer<typeof ScoreRuleSchema>;

/** One line of a place's score: which rule fired, for which requirement, and
 *  what it was worth once the requirement's weight was applied. */
export const ScoreLineSchema = z.object({
  /** Empty for a line that is about the place rather than a requirement
   *  (`proximity`). */
  requirementId: z.string(),
  rule: ScoreRuleSchema,
  /** The weighted contribution — `base * weight`, already applied. */
  delta: z.number(),
  /** The requirement's multiplier, kept so the UI can explain WHY a line is
   *  worth what it is ("celiac counts triple"). */
  weight: z.number(),
  reason: z.string(),
  /**
   * Set when the strongest claim behind this line came from a source worth less
   * than face value (`SOURCE_RELIABILITY`), so the dossier can say so.
   *
   * A discount that changes a ranking and is never shown is the kind of thing
   * this app must not do: a reader comparing two places deserves to know that
   * one of them is trusted less because a volunteer typed its tag.
   */
  discounted: z.boolean().optional(),
});
export type ScoreLine = z.infer<typeof ScoreLineSchema>;

/**
 * The most the corroboration rule can add, before the requirement's weight.
 *
 * Reached only by sources that are trusted at face value: the bonus scales with
 * how much INDEPENDENT reliability agrees, not with how many rows exist. Two
 * volunteers ticking the same tag on two community maps is not the same
 * evidence as a listing and a review agreeing, and a bonus that counted rows
 * would have said it was.
 */
export const MAX_CORROBORATION_BASE = 0.5;

/**
 * The most one requirement can contribute, before its weight.
 *
 * `explicit` at full confidence is `1 + 1 = 2`, and `corroborated` adds `0.5`.
 * Corroboration is deliberately INSIDE the ceiling rather than bonus headroom
 * above it: "a second, independent source says the same thing" is a real part
 * of what a complete answer looks like, and a run that only ever heard from one
 * source should read as the incomplete answer it is rather than as a perfect
 * one.
 */
export const MAX_REQUIREMENT_BASE = 2.5;

/**
 * How far a place's distance from the search centre can move its score, in
 * either direction. Kept here because it is part of the ceiling, and the
 * ceiling is what the percentage divides by.
 */
export const PROXIMITY_MAX = 2;

/**
 * The best score a place could possibly have earned on this run.
 *
 * Computed from the RUN, not from any one place, so every place in a dossier is
 * measured against the same yardstick — otherwise a place the run has no
 * coordinates for would be divided by a smaller number and could display a
 * higher percentage than the place ranked above it.
 *
 * `0` when there is nothing to measure (a run with no requirements), which the
 * caller must read as "no percentage can be stated" rather than as a zero
 * denominator.
 */
export function maxAchievableScore(
  requirements: readonly PlannedRequirement[],
  options: { withProximity?: boolean } = {},
): number {
  const fromRequirements = requirements.reduce(
    (sum, requirement) => sum + requirement.weight * MAX_REQUIREMENT_BASE,
    0,
  );
  if (fromRequirements <= 0) return 0;
  return fromRequirements + (options.withProximity ? PROXIMITY_MAX : 0);
}

/**
 * A raw score as a percentage of `max`, rounded to a whole number.
 *
 * Clamped to `0..100`. A negative raw score means a source actively
 * contradicted a requirement, and there is no honest percentage below "none of
 * what you asked for was established" — the card's red flags and its amber
 * conflict badge are what say the stronger thing, and the ranking still
 * separates the two because it uses the raw score.
 *
 * Returns `undefined` when `max` is not positive: better to show the raw
 * number than to invent a denominator.
 */
export function scorePercent(score: number, max: number): number | undefined {
  if (!Number.isFinite(score) || !Number.isFinite(max) || max <= 0) {
    return undefined;
  }
  return Math.round(Math.min(100, Math.max(0, (score / max) * 100)));
}
