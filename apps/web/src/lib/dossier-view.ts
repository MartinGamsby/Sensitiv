/**
 * How the dossier is laid out: a grid of cards, or a map with the cards in a
 * column beside it.
 *
 * In the URL (`?view=map`) rather than in a `useState`, for the same reason
 * `?place=` is: it survives a reload, it comes back with the Back button, and
 * a link someone sends opens on the view they were looking at. `list` is the
 * default and is never written to the URL — a query parameter that only ever
 * says "the default" is noise in a link.
 */
export const VIEW_PARAM = "view";

export const DOSSIER_VIEWS = ["list", "map"] as const;
export type DossierView = (typeof DOSSIER_VIEWS)[number];

/** Anything unrecognised reads as `list`, including a hand-edited URL. */
export function dossierViewFrom(raw: string | null): DossierView {
  return raw === "map" ? "map" : "list";
}

/**
 * The current URL with the view switched, preserving everything else on it.
 *
 * Built by mutating a copy of the real search params rather than composing a
 * fresh string, so switching views cannot silently drop `?place=` — the two
 * are independent and a reader can legitimately have both.
 */
export function withDossierView(
  params: URLSearchParams,
  view: DossierView,
): string {
  const next = new URLSearchParams(params);
  if (view === "list") next.delete(VIEW_PARAM);
  else next.set(VIEW_PARAM, view);
  const query = next.toString();
  return query === "" ? "" : `?${query}`;
}
