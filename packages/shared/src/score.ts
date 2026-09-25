// Explainable, catalog-driven scoring. Per requirement, per place, a base delta
// multiplied by that requirement's `weight` (see `CatalogRequirement.weight`):
//
//   +2  explicit      a source explicitly marks the requirement (confidence >= 0.8)
//   +1  supported     a supporting claim below that confidence
//   +1  corroborated  two or more DISTINCT sources support it
//   -2  contradicted  at least one source contradicts it
//
// Support is `MAX_SUPPORT_BASE * confidence * source reliability` — PROPORTIONAL,
// with no floor, so the two labels above are only labels and the delta is a
// continuum. Contradiction keeps a floor at `-(1 + confidence)`: see
// `MAX_SUPPORT_BASE` for why the two sides are not symmetrical.
//    0  unverified    only `unclear` evidence, or none at all —
//                     EXCEPT on a `kind: "subject"` requirement, where it is
//                     -0.5, because "we could not tell whether this is even a
//                     Mexican restaurant" is not a neutral fact about a search
//                     for a Mexican restaurant.
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
import { DEFAULT_REQUIREMENT_WEIGHT } from "../catalog/requirements.ts";
import { sourceReliability } from "../catalog/intents.ts";
import { distanceKm } from "./schema/location.ts";
import {
  MAX_CORROBORATION_BASE,
  MAX_SUPPORT_BASE,
  PROXIMITY_MAX,
} from "./schema/score.ts";
import type { Evidence } from "./schema/evidence.ts";
import type { PlannedRequirement } from "./schema/requirement.ts";
import type { ScoreLine, ScoreRule } from "./schema/score.ts";

// This is the ONE implementation of the rubric, and it lives in `shared`
// because a score is not a stored fact — it is a reading of the stored facts.
//
// It used to live in the worker, and a place's score and breakdown were frozen
// into its row at run time. That made the score un-reviewable: the evidence was
// re-read on every page load while the opinion about it never was, so a rubric
// change reached new runs only and nothing in an old dossier could notice it
// was stale. It also hid a real bug — the run's PLANNED requirements were never
// persisted, so the dossier's percentage divided by a ceiling built from the
// chips alone and reported a 51% match as 91%.
//
// Now the worker calls this to rank what it keeps, and the read path calls the
// same function again over the stored evidence. Change a weight here and every
// dossier ever run re-ranks. The durable artifact is the quoted evidence; this
// is what we currently make of it.
export type { ScoreLine, ScoreRule };
export { PROXIMITY_MAX };

export interface PlaceScore {
  score: number;
  conflicted: boolean;
  breakdown: ScoreLine[];
}

/** A supporting claim at/above this confidence is reported as an explicit mark.
 *  Only the LABEL turns on this threshold now — the delta is continuous. */
export const EXPLICIT_MARK_CONFIDENCE = 0.8;

/**
 * `PROXIMITY_MAX` — how far a place's distance from the search centre can move
 * its score — is bounded on purpose, and now lives in `@sensitiv/shared`
 * because it is part of the ceiling the dossier's percentage divides by.
 * Proximity is a real signal (a run for H1S with a 5 km radius returned four
 * top-scoring places 5–7 km away while the one the user wanted sat 1.8 km out
 * and ranked fifth) but it must never overturn a safety requirement on its own.
 * At ±2 it is worth about one moderate requirement and always less than a
 * `weight: 3` verdict, so it reorders places the requirements score alike and
 * little else.
 */

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

/** How far past the radius a place may sit before it is dropped unread. */
export const SEARCH_CUTOFF_OVERSHOOT = 0.5;
/** The most that overshoot may add, so a 100 km search stops at 110 km. */
export const SEARCH_CUTOFF_MAX_EXTRA_KM = 10;

/**
 * The distance past which a place is not worth extracting at all:
 * the radius plus half of it again, but never more than 10 km past it
 * (3 km → 4.5 km, 20 km → 30 km, 100 km → 110 km).
 *
 * The gap between the radius and this cutoff is deliberate. `proximityScore`
 * only costs a place points once it is past the radius, and a strong safety
 * match just outside it should still be able to beat a closer place nothing is
 * known about. Far enough out, though, the place is not what the user asked
 * for, and reading it is time spent on a place they would not go to.
 */
export function searchCutoffKm(radiusKm: number): number {
  return radiusKm + Math.min(radiusKm * SEARCH_CUTOFF_OVERSHOOT, SEARCH_CUTOFF_MAX_EXTRA_KM);
}

/**
 * Words that say what KIND of establishment something is, not what it serves.
 *
 * Stripped from a requirement's label before it is used as a fallback category
 * term, because "Mexican restaurant" against a category of "Mexican restaurant"
 * must match on `mexican` — matching on `restaurant` would call every
 * restaurant in the city a Mexican one.
 */
const GENERIC_CATEGORY_WORDS = new Set([
  "restaurant",
  "restaurants",
  "resto",
  "food",
  "cuisine",
  "place",
  "places",
  "shop",
  "store",
  "grocery",
  "market",
  "bar",
  "spot",
  "eatery",
  "takeout",
  "delivery",
  "apartment",
  "apartments",
  "rental",
  "rentals",
  "housing",
  "service",
  "services",
  // French, since a run's search language decides what the planner writes.
  "restauration",
  "epicerie",
  "commerce",
  "magasin",
  "logement",
  "appartement",
]);

/** Lowercase, strip accents, and turn every separator a category might use
 *  (`;`, `,`, `/`, `·`, `-`, `_`) into a space. For COMPARISON only. */
function normalizeCategory(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * True when `needle`'s words appear as a contiguous run inside `haystack`'s.
 *
 * A token run, never a bare substring: `bar` must not match inside `barbecue`,
 * and `arepa` must not match inside `arepas`… which it does not, and that is the
 * cost of being strict. Hint lists are the place to spell out both forms.
 */
function containsTokenRun(haystack: string, needle: string): boolean {
  const hay = normalizeCategory(haystack).split(" ").filter((t) => t !== "");
  const need = normalizeCategory(needle).split(" ").filter((t) => t !== "");
  if (need.length === 0) return false;
  for (let i = 0; i + need.length <= hay.length; i++) {
    if (need.every((t, j) => hay[i + j] === t)) return true;
  }
  return false;
}

/**
 * The terms that identify this requirement's kind of place when the planner
 * supplied none — every word of its label that is not a generic venue word.
 *
 * This is what makes the common case work with no LLM involvement at all:
 * `3 Amigos` carries the OpenStreetMap category `mexican`, the requirement is
 * labelled `Mexican restaurant`, and before this the place scored ZERO on it.
 * The OSM adapter only emits evidence for catalog requirements it holds a tag
 * map for, so `cuisine=mexican` was stored as the category and then never read
 * by anything.
 */
export function fallbackCategoryTerms(label: string): string[] {
  return normalizeCategory(label)
    .split(" ")
    .filter((word) => word !== "" && !GENERIC_CATEGORY_WORDS.has(word));
}

export type CategoryStanding = "strong" | "related" | "excluded" | "unknown";

/**
 * How a place's own category reads against what was asked for.
 *
 * Checked strongest-first, so a category like `mexican;dessert` counts as the
 * Mexican restaurant it is rather than the dessert shop it also is. `excluded`
 * beats `related` for the same reason in reverse: a place that is BOTH adjacent
 * and disqualified is disqualified.
 *
 * Returns `unknown` for an empty category, which is the honest answer — plenty
 * of sources give none — and scores the same as no evidence at all.
 */
export function categoryStanding(
  category: string | undefined,
  requirement: PlannedRequirement,
): CategoryStanding {
  if (!category || category.trim() === "") return "unknown";
  const hints = requirement.categoryHints;
  const strong =
    hints && hints.strong.length > 0
      ? hints.strong
      : fallbackCategoryTerms(requirement.label);
  if (strong.some((term) => containsTokenRun(category, term))) return "strong";
  if (hints?.excluded.some((term) => containsTokenRun(category, term))) {
    return "excluded";
  }
  if (hints?.related.some((term) => containsTokenRun(category, term))) {
    return "related";
  }
  return "unknown";
}

/** Confidence a bare category match is worth as a supporting claim.
 *
 *  Below `EXPLICIT_MARK_CONFIDENCE`, deliberately: a source saying in words
 *  "this is a Mexican restaurant" is a stronger statement than a taxonomy field
 *  that happens to carry the token, and the two should not tie. */
export const CATEGORY_MATCH_CONFIDENCE = 0.75;

export interface ScoreOptions {
  /** Where the search was actually centred, as the adapter resolved it. */
  center?: { lat: number; lng: number };
  /** The radius the user asked for. Paired with `center`. */
  radiusKm?: number;
  /**
   * The place being scored: coordinates for the proximity term, and `category`
   * for the subject match.
   *
   * The category is a fact every adapter already records and nothing used to
   * read. Google Maps writes "Mexican restaurant", OpenStreetMap writes its
   * `cuisine` tag ("mexican", "arepa;venezuelan", "chocolate;crepe;dessert") —
   * and an OSM place scored ZERO on "Mexican restaurant" however plainly its
   * own category said otherwise, because the OSM adapter only emits evidence
   * for catalog requirements it holds a tag map for.
   */
  place?: { lat?: number; lng?: number; category?: string };
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
  // Which requirements are the KIND OF PLACE being searched for rather than a
  // property it should have. Only `unverified` reads this — see below.
  const isSubject = new Map(
    requirements.map((r) => [r.id, r.kind === "subject"] as const),
  );

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
    const push = (
      rule: ScoreRule,
      base: number,
      reason: string,
      flags: { discounted?: boolean; viaCategory?: boolean } = {},
    ): void => {
      breakdown.push({
        requirementId,
        rule,
        delta: base * weight,
        weight,
        reason,
        ...(flags.discounted ? { discounted: true } : {}),
        ...(flags.viaCategory ? { viaCategory: true } : {}),
      });
    };

    const supports = list.filter((e) => e.polarity === "supports");
    const contradicts = list.filter((e) => e.polarity === "contradicts");
    const supportingSources = new Set(supports.map((e) => e.source));
    // A supporting claim is worth its confidence TIMES how much its source is
    // worth. `diet:gluten_free=yes` on OpenStreetMap is a tag anyone may have
    // typed, with no review and no provenance, and at face value it was
    // carrying places to the top of a dossier about someone's coeliac disease.
    //
    // Contradictions are deliberately NOT discounted — see `SOURCE_RELIABILITY`.
    // "A reviewer says they got glutened here" is not a claim to quietly turn
    // down because of where it was found.
    const supportValue = (e: Evidence): number =>
      e.confidence * sourceReliability(e.source);
    const explicit = supports.some(
      (e) => supportValue(e) >= EXPLICIT_MARK_CONFIDENCE,
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
    // The place's own category, for a requirement that names a KIND of place.
    // Folded in as a support rather than added as a separate line, so a place
    // whose category says "Mexican restaurant" AND whose reviews say so does not
    // collect the credit twice.
    const requirement = requirements.find((r) => r.id === requirementId);
    const standing =
      requirement && requirement.kind === "subject"
        ? categoryStanding(options.place?.category, requirement)
        : "unknown";

    const bestSupport = Math.max(
      0,
      ...supports.map(supportValue),
      standing === "strong" ? CATEGORY_MATCH_CONFIDENCE : 0,
    );
    // True when the claim this line is BUILT on lost something to its source's
    // reliability, so the dossier can say why the number is what it is rather
    // than silently ranking one place below another.
    const strongest = supports.reduce<Evidence | undefined>(
      (best, e) => (best === undefined || supportValue(e) > supportValue(best) ? e : best),
      undefined,
    );
    const discounted =
      strongest !== undefined &&
      supportValue(strongest) === bestSupport &&
      sourceReliability(strongest.source) < 1;
    if (supports.length > 0 || standing === "strong") {
      const byCategory = supports.length === 0;
      push(
        explicit ? "explicit" : "supported",
        MAX_SUPPORT_BASE * bestSupport,
        byCategory
          ? "this place's own category is the kind of place you asked for"
          : explicit
            ? "a source explicitly marks this requirement"
            : "a source supports this requirement",
        { discounted, viaCategory: byCategory },
      );
    }
    // Corroboration is about INDEPENDENT agreement, so it counts distinct
    // sources, not distinct claims: three quotes off one Google Maps page are
    // one source agreeing with itself.
    // Corroboration scales with how much INDEPENDENT reliability agrees, not
    // with how many rows exist. Summing the distinct sources' reliability and
    // subtracting the one that is already paid for in `bestSupport` means a
    // listing plus a community map is worth more than two community maps, and a
    // single source — however many quotes it produced — is worth nothing extra.
    // Clamped to 1, so the ceiling `MAX_REQUIREMENT_BASE` divides by holds.
    const corroboration = Math.min(
      1,
      Math.max(
        0,
        [...supportingSources].reduce((sum, src) => sum + sourceReliability(src), 0) - 1,
      ),
    );
    if (corroboration > 0) {
      push(
        "corroborated",
        MAX_CORROBORATION_BASE * corroboration,
        "two or more sources agree on this requirement",
      );
    }
    if (contradicts.length >= 1) {
      // Face value, unlike support. See `supportValue` above.
      const worst = Math.max(0, ...contradicts.map((e) => e.confidence));
      push("contradicted", -(1 + worst), "a source contradicts this requirement");
    }
    // The two grades between confirmed and contradicted, for a subject nothing
    // settled outright. Both are about the kind of place, so both only fire
    // when no source spoke to the requirement at all.
    //
    // The ladder, at a weight of 3: confirmed +5.25, adjacent 0, unknown -1.5,
    // wrong kind -3. "We could not tell" sits between "close" and "no" on
    // purpose — it is worse news than an adjacent match and better news than a
    // dessert shop, which is exactly how a reader would rank those three.
    const settled = supports.length > 0 || contradicts.length > 0;
    if (!settled && standing === "related") {
      push("related", 0, "a related kind of place, but not the one you asked for", {
        viaCategory: true,
      });
    }
    if (!settled && standing === "excluded") {
      push("mismatched", -1, "this place's own category is a different kind of place", {
        viaCategory: true,
      });
    }
    // `unverified` is the fallthrough — it fires only when NOTHING else did. It
    // used to key off the evidence alone, which meant a place settled by its
    // category alone collected the -0.5 penalty on top of the credit it had
    // just been given.
    if (!settled && standing === "unknown") {
      // `unverified` is 0 for a PROPERTY, and that is right: "the page does not
      // say whether the fryer is shared" is genuinely unknown, and punishing it
      // ranks a cautious extraction below a confident, thinner one.
      //
      // It is NOT right for the SUBJECT of the search. "We could not tell
      // whether this is a Mexican restaurant" is not neutral on a search for a
      // Mexican restaurant — it is a failure to answer the actual question, and
      // at 0 it made being the wrong kind of place entirely free. A real run
      // put `Cookie Stéfanie`, a pastry shop, first on a celiac + "Mexican
      // restaurant" search: brilliant celiac evidence, `unverified` on Mexican,
      // and an actual gluten-free Mexican restaurant in second place.
      //
      // Deliberately -0.5 and not -1: the heavy lifting is done by the +(1+conf)
      // a CONFIRMED subject earns at `SUBJECT_REQUIREMENT_WEIGHT`, so a real
      // match wins by being confirmed rather than by everything else being
      // crushed. Extraction does fail sometimes, and when it does a genuine
      // match should slip a place or two, not fall off the list.
      const subject = isSubject.get(requirementId) === true;
      push(
        "unverified",
        subject ? -0.5 : 0,
        subject
          ? "no source confirmed this is the kind of place you asked for"
          : "no source settled this requirement either way",
      );
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
 * The highest score this place could reach if a page from `source` confirmed
 * every planned requirement at full confidence. This is an upper bound, not an
 * estimate.
 *
 * It exists so an adapter can skip a page load that cannot change the outcome:
 * if enough places already outscore this ceiling, then nothing the page could
 * say would get the place into the results. It holds because evidence is only
 * ever appended. A contradiction already on file stays on file, and a new
 * supporting claim can at most move a requirement's best support to 1 (it also
 * removes `unverified` and `mismatched`, which only helps). Corroboration is
 * computed over the place's existing sources plus `source`, which is the most
 * that claims from `source` could ever add to it.
 *
 * Not bounded: a claim under an off-plan `custom_*` id that the extractor
 * invents on its own. Such a claim scores at `DEFAULT_REQUIREMENT_WEIGHT`, and
 * the bound deliberately ignores it rather than guess how many there will be.
 */
export function bestCaseScore(
  evidence: readonly Evidence[],
  options: ScoreOptions,
  source: string,
): number {
  const confirmed: Evidence[] = (options.requirements ?? []).map((r) => ({
    requirementId: r.id,
    claim: "best case",
    polarity: "supports",
    quote: "",
    source,
    sourceUrl: "",
    confidence: 1,
  }));
  return scorePlace([...evidence, ...confirmed], options).score;
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
