// How the dossier can be ordered, and the comparators that do it.
//
// This is ORDERING, not filtering: every place the run found stays on the page
// under every option. A dossier whose list silently shrank depending on a
// dropdown would be a much worse thing to hand someone researching where they
// can safely eat — "no results" and "none near you" are different answers, and
// only one of them is true.
import {
  distanceKm,
  requirementStanding,
  type DossierPlace,
  type PlannedRequirement,
} from "@sensitiv/shared";

/** A dossier place with its distance from a chosen origin worked out. */
export type PlacedDossierPlace = DossierPlace & { distanceKm?: number };

/**
 * Measure every place against an origin.
 *
 * Computed here rather than stored per place, because a stored distance
 * discards the point it was measured from. Keeping the CENTRE on the run means
 * the same dossier can be re-measured against a different origin — another
 * postal code, or wherever the reader actually is — without re-running the
 * search. `origin` is the run's own centre today; that is the only thing that
 * would have to change to offer "distance from somewhere else".
 */
export function placesWithDistance(
  places: readonly DossierPlace[],
  origin: { lat: number; lng: number } | undefined,
): PlacedDossierPlace[] {
  if (!origin) return places.map((p) => ({ ...p }));
  return places.map((place) => {
    const { lat, lng } = place.place;
    if (typeof lat !== "number" || typeof lng !== "number") return { ...place };
    return {
      ...place,
      distanceKm: Math.round(distanceKm(origin, { lat, lng }) * 100) / 100,
    };
  });
}

/** The orderings that always exist, whatever the run was looking for. */
export const FIXED_SORTS = ["recommended", "closest"] as const;
export type FixedSort = (typeof FIXED_SORTS)[number];

/**
 * A chosen ordering. `requirement` carries the id when the user picked one of
 * the per-requirement options, which are derived from the run and so cannot be
 * a fixed union.
 */
export type DossierSort =
  | { kind: FixedSort }
  | { kind: "requirement"; requirementId: string };

/** Serialised for a `<select>` value and back. */
export function sortToValue(sort: DossierSort): string {
  return sort.kind === "requirement" ? `requirement:${sort.requirementId}` : sort.kind;
}

export function sortFromValue(value: string): DossierSort {
  if (value.startsWith("requirement:")) {
    return { kind: "requirement", requirementId: value.slice("requirement:".length) };
  }
  return { kind: (FIXED_SORTS as readonly string[]).includes(value) ? (value as FixedSort) : "recommended" };
}

/**
 * The per-requirement options for a run, in catalog-weight order so the
 * safety-critical ones come first.
 *
 * Only requirements some place actually has evidence for: offering "best for
 * wheelchair access" when not one source mentioned it produces a dropdown entry
 * that reorders nothing, which reads as a broken control.
 */
export function requirementSortOptions(
  requirements: readonly PlannedRequirement[],
  places: readonly DossierPlace[],
): PlannedRequirement[] {
  const settled = new Set<string>();
  for (const place of places) {
    for (const item of place.evidence) {
      if (item.polarity !== "unclear") settled.add(item.requirementId);
    }
  }
  return requirements
    .filter((r) => settled.has(r.id))
    .sort((a, b) => b.weight - a.weight);
}

/**
 * Order a dossier's places. Always returns a new array — the caller renders
 * from it and the original order (the run's own ranking) stays intact.
 *
 * Every comparator falls back to the overall score, so two places that tie on
 * the chosen axis still appear in a stable, meaningful order rather than
 * whatever order the database happened to return.
 */
export function sortPlaces(
  places: readonly PlacedDossierPlace[],
  sort: DossierSort,
): PlacedDossierPlace[] {
  const byScore = (a: DossierPlace, b: DossierPlace): number => b.score - a.score;
  const copy = [...places];

  if (sort.kind === "closest") {
    return copy.sort((a, b) => {
      const da = a.distanceKm;
      const db = b.distanceKm;
      // A place with no coordinates sorts LAST rather than as 0 km. "We do not
      // know where this is" must never be presented as "this is right here".
      if (da === undefined && db === undefined) return byScore(a, b);
      if (da === undefined) return 1;
      if (db === undefined) return -1;
      return da === db ? byScore(a, b) : da - db;
    });
  }

  if (sort.kind === "requirement") {
    return copy.sort((a, b) => {
      const sa = requirementStanding(a.evidence, sort.requirementId);
      const sb = requirementStanding(b.evidence, sort.requirementId);
      return sa === sb ? byScore(a, b) : sb - sa;
    });
  }

  return copy.sort(byScore);
}
