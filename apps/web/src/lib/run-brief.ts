import type { Location, PlannedRequirement } from "@sensitiv/shared";

/**
 * What a run was ASKED, as opposed to what it found.
 *
 * The run page had none of this: it said "Research run" over a UUID, so a
 * reopened or shared link told the reader nothing about the question the
 * results answer — not the subject, not the requirements that were checked,
 * not where it looked. The dossier carries the answer; this carries the
 * question, and both belong on the page.
 *
 * Read off the `jobs` row server-side rather than from the dossier, because
 * it has to render while the run is still going and has produced no dossier
 * at all.
 */
export interface RunBriefData {
  /** What the user typed. May be empty — a chips-only run is valid. */
  requestText: string;
  location: Location;
  requirements: PlannedRequirement[];
  /** BCP-47 code the sources were searched in. */
  searchLang: string;
  /** Unix ms. */
  createdAt: number;
  /** Where the adapters actually searched, when a run resolved a point. */
  searchCenter?: { lat: number; lng: number };
}

/**
 * The heading for a run: what was typed, or failing that where it looked.
 *
 * A run with no free text is not a broken run — the five requirement chips
 * are a complete question on their own ("anywhere celiac-safe near me") — so
 * this falls back to the place rather than to a placeholder. Returns
 * `undefined` only when there is genuinely nothing, and the caller uses the
 * generic title then.
 */
export function runHeadline(brief: RunBriefData): string | undefined {
  const typed = brief.requestText.trim();
  if (typed !== "") return typed;
  const place = brief.location.query.trim();
  return place === "" ? undefined : place;
}

/**
 * Coordinates rounded for display: ~11 m, which is as precise as a dropped
 * pin means anything, and short enough to read inline.
 */
export function formatCoords(point: { lat: number; lng: number }): string {
  return `${point.lat.toFixed(4)}, ${point.lng.toFixed(4)}`;
}
