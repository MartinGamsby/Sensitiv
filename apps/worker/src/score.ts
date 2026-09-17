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
import { distanceKm } from "@sensitiv/shared";
import type { Evidence, PlannedRequirement } from "@sensitiv/shared";

export type ScoreRule =
  | "explicit"
  | "supported"
  | "corroborated"
  | "contradicted"
  | "unverified"
  | "proximity";

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

/** A supporting claim at/above this confidence is reported as an explicit mark.
 *  Only the LABEL turns on this threshold now — the delta is continuous. */
export const EXPLICIT_MARK_CONFIDENCE = 0.8;

/**
 * How far a place's distance from the search centre can move its score.
 *
 * Bounded on purpose. Proximity is a real signal — a run for H1S with a 5 km
 * radius returned four top-scoring places 5–7 km away while the one the user
 * wanted sat 1.8 km out and ranked fifth — but it must never be able to
 * overturn a safety requirement on its own. At ±2 it is worth about one
 * moderate requirement and always less than a `weight: 3` verdict, so it
 * reorders places the requirements score alike and little else.
 */
export const PROXIMITY_MAX = 2;

/**
 * Score contribution for being `distanceKm` from the centre of a search with
 * radius `radiusKm`: `+PROXIMITY_MAX` at the centre, `0` exactly on the radius,
 * and down to `-PROXIMITY_MAX` at twice the radius or beyond. Linear, because a
 * user who asks for 5 km means it and the penalty should start the moment the
 * radius is crossed, not somewhere softly after it.
 */
export function proximityScore(distanceKm: number, radiusKm: number): number {
  if (!Number.isFinite(distanceKm) || !Number.isFinite(radiusKm) || radiusKm <= 0) {
    return 0;
  }
  return PROXIMITY_MAX * Math.max(-1, Math.min(1, 1 - distanceKm / radiusKm));
}

export interface ScoreOptions {
  /** Where the search was actually centred, as the adapter resolved it. */
  center?: { lat: number; lng: number };
  /** The radius the user asked for. Paired with `center`. */
  radiusKm?: number;
  /** The place being scored, for the proximity term. */
  place?: { lat?: number; lng?: number };
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

    // Continuous, not two buckets. The old rubric gave every supporting claim
    // either +2 or +1, so a whole result set landed on a handful of integers
    // and ties fell through to review count. Scaling by the strongest
    // supporting confidence spreads them out: a category field the extractor
    // reports at 0.95 now outscores a passing review mention at 0.55, which is
    // the distinction the extractor was already making and the score was
    // throwing away.
    // Same magnitude the shared `requirementStanding` reports, so the dossier's
    // per-requirement ordering and this ranking cannot disagree about which of
    // two places better satisfies a requirement.
    const bestSupport = Math.max(0, ...supports.map((e) => e.confidence));
    if (supports.length > 0) {
      push(
        explicit ? "explicit" : "supported",
        1 + bestSupport,
        explicit
          ? "a source explicitly marks this requirement"
          : "a source supports this requirement",
      );
    }
    // Corroboration is about INDEPENDENT agreement, so it counts distinct
    // sources, not distinct claims: three quotes off one Google Maps page are
    // one source agreeing with itself.
    if (supportingSources.size >= 2) {
      push("corroborated", 0.5, "two or more sources agree on this requirement");
    }
    if (contradicts.length >= 1) {
      const worst = Math.max(0, ...contradicts.map((e) => e.confidence));
      push("contradicted", -(1 + worst), "a source contradicts this requirement");
    }
    if (supports.length === 0 && contradicts.length === 0) {
      push("unverified", 0, "no source settled this requirement either way");
    }
    if (supports.length > 0 && contradicts.length > 0) {
      conflicted = true;
    }
  }

  // Proximity is a property of the PLACE, not of any one requirement, so it is
  // added once rather than per requirement — otherwise a place with three
  // requirements would be penalised three times for the same kilometre.
  const center = options.center;
  const place = options.place;
  if (
    center &&
    typeof place?.lat === "number" &&
    typeof place?.lng === "number" &&
    options.radiusKm
  ) {
    const km = distanceKm(center, { lat: place.lat, lng: place.lng });
    breakdown.push({
      requirementId: "",
      rule: "proximity",
      delta: proximityScore(km, options.radiusKm),
      weight: 1,
      reason: `${km.toFixed(1)} km from the search centre`,
    });
  }

  const score = breakdown.reduce((sum, line) => sum + line.delta, 0);
  // Two decimals: enough to break the ties this exists to break, few enough
  // that a stored score stays readable.
  return { score: Math.round(score * 100) / 100, conflicted, breakdown };
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
