/**
 * Display helpers for the two things a dossier shows verbatim from a source:
 * the source's own id, and — for OpenStreetMap — a raw tag as the quote.
 *
 * Both are honest data that reads badly. `openstreetmap` and
 * `diet:gluten_free=only` are exactly what the worker stored and exactly what a
 * reader should be able to check, so nothing here rewrites or hides them: the
 * label is a presentation layer over the id, and the tag keeps its key and
 * value intact while gaining the shape of a key/value pair instead of the shape
 * of a sentence someone said out loud.
 */

/**
 * Adapter id -> the name the source calls itself.
 *
 * A LOOKUP with a fallback, never a switch: an id that is not here (a future
 * adapter, a housing source) still renders, humanized, rather than vanishing or
 * throwing. Adapter ids are not catalog entries — the catalog owns intents and
 * requirements — so this table lives with the UI that reads it.
 */
const SOURCE_LABELS: Readonly<Record<string, string>> = {
  google_maps: "Google Maps",
  openstreetmap: "OpenStreetMap",
  yelp: "Yelp",
  find_me_gluten_free: "Find Me Gluten Free",
  store_locator: "Store locator",
  kijiji: "Kijiji",
  craigslist: "Craigslist",
};

/** `google_maps` -> `Google Maps`; anything unknown -> `Some Other Source`. */
export function sourceLabel(id: string): string {
  const known = SOURCE_LABELS[id];
  if (known) return known;
  const words = id.replace(/[_-]+/g, " ").trim();
  if (words === "") return id;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export interface TagQuote {
  key: string;
  value: string;
}

/**
 * A quote that is a structured tag rather than something a human wrote.
 *
 * `openstreetmap` builds its quotes as `key=value` precisely because the tag IS
 * the evidence — verbatim by construction, no LLM in the loop — but rendered as
 * an italic “…” pull-quote it reads like a machine talking. Recognising the
 * shape lets the card render it as what it is.
 *
 * Deliberately strict: an OSM key is lowercase letters, digits, `_`, `:` and
 * `-`, and the value has no whitespace. A real review that happens to contain
 * an `=` ("gluten free = life") has spaces around it and is left alone.
 */
export function parseTagQuote(quote: string): TagQuote | undefined {
  const match = /^([a-z][a-z0-9_:-]*)=(\S+)$/.exec(quote.trim());
  if (!match) return undefined;
  return { key: match[1]!, value: match[2]! };
}
