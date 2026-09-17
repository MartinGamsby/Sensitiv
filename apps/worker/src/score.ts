// Explainable, catalog-driven scoring. Per requirement, per place, a base delta
// multiplied by that requirement's `weight` (see `CatalogRequirement.weight`):
//
//   +2  explicit      a source explicitly marks the requirement (confidence >= 0.8)
//   +1  supported     a supporting claim below that confidence
//   +1  corroborated  two or more DISTINCT sources support it
//   -2  contradicted  at least one source contradicts it
//    0  unverified    only `unclear` evidence, or none at all
//
// Sum per place; keep the per-rule breakdown. A place with BOTH supporting and
// contradicting evidence for one requirement is `conflicted` (rendered amber)
// and is never filtered out.
//
// Two rules that used to be here are deliberately gone:
//
//   * the flat `-1 "only a single source mentions this"` penalty. Sensitiv has
//     exactly ONE working source (`google_maps`; yelp / find_me_gluten_free /
//     store_locator are v1.1 stubs returning nothing), so `sources.size === 1`
//     was ALWAYS true and the penalty fired on essentially every requirement of
//     every place — while its mirror image, the `+1` multi-source bonus, could
//     never fire at all. A rubric built for cross-source corroboration was
//     quietly acting as a flat tax. Corroboration is now a BONUS only, so a
//     single-source run scores honestly and a future second adapter still pays.
//
//   * treating `unclear` as negative. `unclear` used to create a list entry
//     that then tripped that same `-1`, which made "the page does not say"
//     score WORSE than "no evidence at all" (0). Hedging is what we ask the
//     extractor to do when a page is silent; punishing it ranked cautious,
//     correct extractions below confident, thinner ones. `unclear` is now 0 —
//     unknown sits between known-good and known-bad, which is where it belongs.
//
// Together those two made a real result absurd: on a celiac + "Italian" search,
// `Veravin 2.0` — a restaurant Google itself categorises "Restaurant sans
// gluten" — scored -3 and ranked LAST, below seven wheat-flour restaurants,
// because its one celiac support was taxed -1 and "not Italian" cost -2.
import { DEFAULT_REQUIREMENT_WEIGHT } from "@sensitiv/shared/catalog/index";
import type { Evidence, PlannedRequirement } from "@sensitiv/shared";

export type ScoreRule =
  | "explicit"
  | "supported"
  | "corroborated"
  | "contradicted"
  | "unverified";

export interface ScoreLine {
  requirementId: string;
  rule: ScoreRule;
  /** The weighted contribution — `base * weight`, already applied. */
  delta: number;
  /** The requirement's multiplier, kept so the UI can explain WHY a line is
   *  worth what it is ("celiac counts triple"). */
  weight: number;
  reason: string;
}

export interface PlaceScore {
  score: number;
  conflicted: boolean;
  breakdown: ScoreLine[];
}

/** A supporting claim at/above this confidence counts as an explicit mark. */
export const EXPLICIT_MARK_CONFIDENCE = 0.8;

export interface ScoreOptions {
  /**
   * The requirements this run planned. Supplies each one's `weight`, and lets a
   * requirement NO source mentioned still get an honest `unverified` line —
   * "we looked for a dedicated gluten-free kitchen and found nothing" is a
   * different, more useful statement than the requirement silently vanishing
   * from the dossier.
   */
  requirements?: readonly PlannedRequirement[];
}

export function scorePlace(
  evidence: readonly Evidence[],
  options: ScoreOptions = {},
): PlaceScore {
  const requirements = options.requirements ?? [];
  const weightOf = (requirementId: string): number =>
    requirements.find((r) => r.id === requirementId)?.weight ??
    DEFAULT_REQUIREMENT_WEIGHT;

  const breakdown: ScoreLine[] = [];
  let conflicted = false;

  const byRequirement = new Map<string, Evidence[]>();
  // Seed with every planned requirement so the ones nothing mentioned still
  // produce an `unverified` line below, then fold the evidence in.
  for (const requirement of requirements) byRequirement.set(requirement.id, []);
  for (const item of evidence) {
    const list = byRequirement.get(item.requirementId) ?? [];
    list.push(item);
    byRequirement.set(item.requirementId, list);
  }

  for (const [requirementId, list] of byRequirement) {
    const weight = weightOf(requirementId);
    const push = (rule: ScoreRule, base: number, reason: string): void => {
      breakdown.push({ requirementId, rule, delta: base * weight, weight, reason });
    };

    const supports = list.filter((e) => e.polarity === "supports");
    const contradicts = list.filter((e) => e.polarity === "contradicts");
    const supportingSources = new Set(supports.map((e) => e.source));
    const explicit = supports.some(
      (e) => e.confidence >= EXPLICIT_MARK_CONFIDENCE,
    );

    if (explicit) {
      push("explicit", 2, "a source explicitly marks this requirement");
    } else if (supports.length > 0) {
      push("supported", 1, "a source supports this requirement");
    }
    // Corroboration is about INDEPENDENT agreement, so it counts distinct
    // sources, not distinct claims: three quotes off one Google Maps page are
    // one source agreeing with itself.
    if (supportingSources.size >= 2) {
      push("corroborated", 1, "two or more sources agree on this requirement");
    }
    if (contradicts.length >= 1) {
      push("contradicted", -2, "a source contradicts this requirement");
    }
    if (supports.length === 0 && contradicts.length === 0) {
      push("unverified", 0, "no source settled this requirement either way");
    }
    if (supports.length > 0 && contradicts.length > 0) {
      conflicted = true;
    }
  }

  const score = breakdown.reduce((sum, line) => sum + line.delta, 0);
  return { score, conflicted, breakdown };
}

/**
 * Requirement ids this place still has no `supports`/`contradicts` evidence
 * for, heaviest first — the queue for the adapter's enrichment pass. A card
 * snippet on a results page almost never settles "dedicated gluten-free
 * kitchen"; the place's own detail page or website usually does, and this says
 * which places are worth that extra page load.
 */
export function unverifiedRequirements(
  evidence: readonly Evidence[],
  requirements: readonly PlannedRequirement[],
): PlannedRequirement[] {
  const settled = new Set(
    evidence
      .filter((e) => e.polarity === "supports" || e.polarity === "contradicts")
      .map((e) => e.requirementId),
  );
  return requirements
    .filter((r) => !settled.has(r.id))
    .sort((a, b) => b.weight - a.weight);
}
