/** The query key that names the open place. Exported so the card, the modal
 *  and the tests cannot disagree about it. */
export const PLACE_PARAM = "place";

/**
 * The address of one place's detail view: the run's own URL plus `?place=`.
 *
 * A query parameter rather than a `/places/<key>` path segment, and that is
 * not a shortcut. The detail is an overlay ON the dossier — the list stays
 * behind it, keeps its scroll position and its sort, and closing returns to
 * exactly what the reader was looking at. Expressing that as a child route
 * needs Next's intercepting routes, and `(.)places/[key]` under `[locale]`
 * crashes the App Router client with `initialTree is not iterable`
 * (Next 15.1.3, `navigate-reducer`): the server renders the intercepted route
 * and answers 200, then the client throws building its tree. Verified in the
 * browser before this was written.
 *
 * Staying on one route is also what makes opening a place instant: the
 * dossier is already in memory, so the overlay needs no second fetch.
 *
 * A place has no row id in the dossier — `PlaceDetail` is the shape the UI
 * has — so the value is its `canonicalKey`, unique per job, the same key the
 * photo route uses.
 *
 * Deliberately NOT locale-prefixed: `@/i18n/navigation`'s `Link` adds that,
 * and doing it here too would produce `/en/en/jobs/...`.
 */
export function placeDetailPath(jobId: string, canonicalKey: string): string {
  const params = new URLSearchParams({ [PLACE_PARAM]: canonicalKey });
  return `/jobs/${encodeURIComponent(jobId)}?${params.toString()}`;
}
