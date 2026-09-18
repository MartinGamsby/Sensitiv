// The second real source — and the first that needs no credentials at all.
//
// OpenStreetMap, read through the Overpass API. Three things make it a
// different KIND of source from `google_maps`, and all three are the point:
//
//   1. It is OPEN DATA (ODbL) on a documented public API. The two sources the
//      roadmap originally named both forbid this outright: Yelp's robots.txt
//      prohibits "any robot, spider, service search/retrieval application, or
//      other automated device, process or means to access, retrieve, copy,
//      scrape, or index any portion of the service or any content", and Find Me
//      Gluten Free names `anthropic-ai` / `ClaudeBot` / `GPTBot` by user agent
//      and disallows them from every listing path it has (`/biz`, `/ca`, `/us`,
//      `/search`, `/map`). Sensitiv IS one of those agents. Overpass asks only
//      that callers identify themselves and keep the load reasonable, which is
//      one POST per job with a real User-Agent.
//   2. There is NO LLM CALL and NO BROWSER. The tags ARE the evidence:
//      `diet:gluten_free=only` is a fact a surveyor recorded, not prose to be
//      interpreted. So extraction here is deterministic, free, exact, and its
//      quotes are verbatim by construction rather than by the substring check
//      `extract.ts` needs for model output. It is also the only adapter that
//      returns real results with an entirely empty `.env`.
//   3. It answers a DIFFERENT question, which is what makes it worth adding at
//      all. Google Maps knows what a place calls itself and what reviewers
//      said; OSM knows what someone recorded about the kitchen and the
//      entrance. `Parc Sans Gluten` is tagged `diet:gluten_free=only` AND
//      `wheelchair=no` — a place that is perfect on one requirement and
//      disqualified on another, which is exactly the shape the dossier's
//      `conflicted` state and the score's `corroborated` bonus were built for
//      and have never had a second source to exercise.
//
// What this adapter deliberately does NOT do:
//
//   * It does not report `AdapterResult.center`. `google_maps` resolves the
//     search centre through the only geocoder in this stack that can read a
//     postal code, and the runner takes the first centre any adapter reports.
//     This adapter finishes in seconds and Maps takes minutes, so reporting one
//     here would mean the worse centre won essentially every race — invisibly.
//   * It does not try to answer `allergy` or `mold`. OSM has no allergen
//     tagging convention worth trusting and no rental-condition data at all.
//     Saying nothing is the honest output; inventing a reading from `cuisine`
//     or a description would not be.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  EvidenceSchema,
  PlaceDetailSchema,
  isCoarseBoundingBox,
  type Evidence,
  type EvidencePolarity,
  type Location,
  type PlannedRequirement,
  type SourceMode,
  type UiLocale,
} from "@sensitiv/shared";
import { canonicalKey } from "../merge.ts";
import { describeError, isSafeSiteUrl, safePhotoUrl } from "../util.ts";
import type { FetchLike } from "../http.ts";
import type {
  Adapter,
  AdapterContext,
  AdapterResult,
  PlaceFinding,
} from "./types.ts";

/** The ONLY upstreams this adapter will ever call. Constants, never assembled
 *  from job input — the same rule `/api/geocode` follows, for the same reason. */
const OVERPASS_ENDPOINT = "https://overpass-api.de/api/interpreter";
const NOMINATIM_SEARCH_URL = "https://nominatim.openstreetmap.org/search";

/** Overpass and Nominatim both ask callers to identify themselves. */
const USER_AGENT =
  "Sensitiv/0.1 (research-assistant; +https://github.com/sensitiv) openstreetmap-adapter";

/** Server-side query budget, in seconds — what Overpass itself enforces. */
const OVERPASS_TIMEOUT_S = 25;
/** Our own wall-clock bound, comfortably above the server's. */
const OVERPASS_FETCH_TIMEOUT_MS = 30_000;
const NOMINATIM_TIMEOUT_MS = 8_000;

/** Hard cap on what Overpass returns. A union query over a dense city centre
 *  can match a lot; this bounds both the response and the work below it. */
const MAX_ELEMENTS = 200;

/** Cap on the `around:` radius handed to Overpass. `Location.radiusKm` allows
 *  up to 500 km, which over a dense region is a query neither side should be
 *  asked to run. */
const MAX_SEARCH_RADIUS_KM = 25;

const FIXTURE_URL = new URL(
  "../../fixtures/openstreetmap-plateau.json",
  import.meta.url,
);

// ---------------------------------------------------------------------------
// Catalog requirement -> OSM tag
// ---------------------------------------------------------------------------

/**
 * How ONE OSM tag value reads against a requirement.
 *
 * `confidence` is load-bearing, not decoration: `score.ts` reports a supporting
 * claim at/above `EXPLICIT_MARK_CONFIDENCE` (0.8) as an *explicit mark* and
 * scales the delta by it. So the numbers below are a judgement about how much
 * each tag value actually settles the requirement's `must`, and the celiac row
 * is where that matters most — see its note.
 */
interface TagReading {
  polarity: EvidencePolarity;
  confidence: number;
}

interface RequirementTagging {
  /**
   * The OSM key for this requirement, or `undefined` when it cannot be
   * answered from tags for this particular planned requirement — a
   * `diet` requirement whose sub-picker value is Low-FODMAP, say, which OSM
   * has no tag for. `undefined` means "not queried and not read", never
   * "assume no".
   */
  key(requirement: PlannedRequirement): string | undefined;
  /** Tag VALUE -> what it says. A value not listed here is IGNORED rather than
   *  guessed at; OSM tag values are open-ended and a wrong guess becomes stored
   *  evidence. */
  readings: Readonly<Record<string, TagReading>>;
  /**
   * Values selective enough to build the search on.
   *
   * `wheelchair` is deliberately absent from this list on the `access` row: it
   * is tagged on a large fraction of all venues, so filtering on its presence
   * returns "every mapped restaurant in the city" rather than a candidate set.
   * Accessibility is an attribute you CHECK on candidates. When `access` is the
   * only requirement there is nothing else to filter on, so the positive values
   * are used — which is both selective and exactly what the user asked for.
   */
  searchValues: readonly string[];
}

/**
 * Keyed by CATALOG id, looked up at runtime, never switched on — the same shape
 * as `REQUIREMENT_TERMS` in `packages/shared/src/planner/queries.ts`. A
 * requirement id this table does not know (a new catalog entry, or any
 * `custom_<slug>` the planner invents from free text) is simply not researched
 * here, which is the catalog's "fail closed" rule.
 */
const REQUIREMENT_TAGS: Readonly<Record<string, RequirementTagging>> = {
  celiac: {
    key: () => "diet:gluten_free",
    readings: {
      // The catalog's own `satisfiedByHints` for celiac: an ENTIRELY
      // gluten-free venue meets the musts by construction — an all-GF kitchen
      // is a dedicated gluten-free kitchen and has no gluten fryer to share.
      only: { polarity: "supports", confidence: 0.95 },
      // Deliberately BELOW the 0.8 explicit-mark threshold. `diet:gluten_free=yes`
      // means "gluten-free options are available", which is not the celiac
      // requirement's must ("dedicated gluten-free kitchen or documented GF
      // protocol"). Reporting a menu option as an explicit mark of kitchen
      // safety is the precise error this app exists to avoid making.
      yes: { polarity: "supports", confidence: 0.6 },
      limited: { polarity: "unclear", confidence: 0.4 },
      no: { polarity: "contradicts", confidence: 0.85 },
    },
    searchValues: ["only", "yes", "limited"],
  },
  access: {
    key: () => "wheelchair",
    readings: {
      // The catalog's `satisfiedByHints` for access: "the listing carries an
      // explicit wheelchair-accessible entrance attribute — that IS the
      // step-free entrance must". Unlike celiac, the tag and the must are the
      // same claim, so this one earns the explicit mark.
      designated: { polarity: "supports", confidence: 0.95 },
      yes: { polarity: "supports", confidence: 0.9 },
      limited: { polarity: "unclear", confidence: 0.5 },
      no: { polarity: "contradicts", confidence: 0.9 },
    },
    searchValues: ["yes", "designated"],
  },
  diet: {
    key: (requirement) => {
      const tag = requirement.diet ? DIET_TAGS[requirement.diet] : undefined;
      return tag ? `diet:${tag}` : undefined;
    },
    readings: {
      only: { polarity: "supports", confidence: 0.95 },
      // Unlike celiac, "halal options are available" IS what a halal diner is
      // asking about — the requirement is about the food, not about kitchen
      // containment — so this one is an explicit mark.
      yes: { polarity: "supports", confidence: 0.85 },
      limited: { polarity: "unclear", confidence: 0.4 },
      no: { polarity: "contradicts", confidence: 0.85 },
    },
    searchValues: ["only", "yes", "limited"],
  },
};

/**
 * `dietOptions` id -> OSM `diet:*` suffix. Only the two the OSM community
 * actually tags; Low-FODMAP, low-histamine and "Other" have no convention, so
 * they resolve to no key and this adapter stays silent about them rather than
 * reading someone else's tag as a proxy.
 */
const DIET_TAGS: Readonly<Record<string, string>> = {
  halal: "halal",
  kosher: "kosher",
};

/**
 * What a tag VALUE means, in the reader's language.
 *
 * Generic over the requirement on purpose: OSM's `yes` / `no` / `limited` /
 * `only` / `designated` vocabulary means the same thing whatever key it is on,
 * so one table of five phrases covers every requirement instead of a
 * per-requirement sentence per locale. The requirement's own label supplies the
 * subject, and it is already in the UI locale.
 */
const VALUE_PHRASES: Readonly<Record<string, Record<UiLocale, string>>> = {
  only: {
    en: "OpenStreetMap records this venue as entirely dedicated to it",
    fr: "OpenStreetMap indique un établissement entièrement dédié à cela",
  },
  designated: {
    en: "OpenStreetMap records it as specifically provided for here",
    fr: "OpenStreetMap l’indique comme spécifiquement aménagé ici",
  },
  yes: {
    en: "OpenStreetMap records it as available here",
    fr: "OpenStreetMap l’indique comme disponible ici",
  },
  limited: {
    en: "OpenStreetMap records it as only partly available here",
    fr: "OpenStreetMap l’indique comme seulement partiellement disponible ici",
  },
  no: {
    en: "OpenStreetMap records it as not available here",
    fr: "OpenStreetMap l’indique comme non disponible ici",
  },
};

/**
 * Which OSM venue types each catalog intent covers.
 *
 * Keyed by intent id and looked up, like everything else. An intent absent from
 * this table is one this adapter cannot serve — `housing` and `services` have
 * no meaningful OSM equivalent for what Sensitiv asks about — and `supports()`
 * below is derived from these keys rather than hardcoded beside them, so the
 * two can never disagree.
 */
const INTENT_FILTERS: Readonly<Record<string, readonly string[]>> = {
  dining: [
    '["amenity"~"^(restaurant|cafe|fast_food|pub|bar|ice_cream|food_court)$"]',
    '["shop"~"^(bakery|pastry|deli|confectionery)$"]',
  ],
  grocery: [
    '["shop"~"^(supermarket|convenience|greengrocer|health_food|organic|deli|farm)$"]',
  ],
};

// ---------------------------------------------------------------------------
// Upstream response shapes
// ---------------------------------------------------------------------------

const OverpassElementSchema = z.object({
  type: z.enum(["node", "way", "relation"]),
  id: z.number().int().nonnegative(),
  lat: z.number().optional(),
  lon: z.number().optional(),
  center: z.object({ lat: z.number(), lon: z.number() }).optional(),
  // Free-form by definition: OSM tags are whatever people typed. Read
  // defensively below, never trusted into a URL or a number without a check.
  tags: z.record(z.string()).optional(),
});
type OverpassElement = z.infer<typeof OverpassElementSchema>;

const OverpassResponseSchema = z.object({
  elements: z.array(OverpassElementSchema).default([]),
});

const FixtureFileSchema = z.object({
  /** Recorded `around:` centre, so the fixture's places sit where they claim. */
  center: z.object({ lat: z.number(), lng: z.number() }).optional(),
  response: OverpassResponseSchema,
});

// ---------------------------------------------------------------------------
// Query building
// ---------------------------------------------------------------------------

/** One `key~"^(v1|v2)$"` tag filter, or `undefined` when the requirement has no
 *  OSM key. Values come from our own constant table, never from job input. */
function tagFilter(requirement: PlannedRequirement): string | undefined {
  const tagging = requirement.catalogId
    ? REQUIREMENT_TAGS[requirement.catalogId]
    : undefined;
  if (!tagging) return undefined;
  const key = tagging.key(requirement);
  if (!key) return undefined;
  return `["${key}"~"^(${tagging.searchValues.join("|")})$"]`;
}

/** The distinct tag filters this run can search on. Empty means OpenStreetMap
 *  has nothing to say about anything the user asked for — a complete answer,
 *  not a failure, and one that needs no centre to establish. */
export function searchableTagFilters(
  requirements: readonly PlannedRequirement[],
): string[] {
  return [
    ...new Set(
      requirements
        .map(tagFilter)
        .filter((filter): filter is string => filter !== undefined),
    ),
  ];
}

/** The distinct venue-type filters for these intents. */
function venueFilters(intentIds: readonly string[]): string[] {
  return [...new Set(intentIds.flatMap((id) => INTENT_FILTERS[id] ?? []))];
}

/**
 * The Overpass QL for this run.
 *
 * A UNION over (venue type × requirement tag), not an intersection. OSM tagging
 * is sparse and voluntary: a place that is both tagged gluten-free AND tagged
 * halal is rare enough that an `AND` query would usually return nothing at all.
 * The union finds everything either requirement can vouch for, and the score —
 * which reads every relevant tag off every returned place, positive and
 * negative — is what sorts them out afterwards.
 *
 * Returns `undefined` when there is nothing to search for or nowhere to search
 * it, so the caller never issues a query that means nothing.
 */
export function buildOverpassQuery(args: {
  intentIds: readonly string[];
  requirements: readonly PlannedRequirement[];
  center: { lat: number; lng: number };
  radiusKm: number;
}): string | undefined {
  const venues = venueFilters(args.intentIds);
  const tags = searchableTagFilters(args.requirements);
  if (venues.length === 0 || tags.length === 0) return undefined;

  const radiusM = Math.round(
    Math.min(MAX_SEARCH_RADIUS_KM, Math.max(0.2, args.radiusKm)) * 1000,
  );
  // Six decimals is ~10 cm, and keeps the query readable in a log line.
  const around = `(around:${radiusM},${args.center.lat.toFixed(6)},${args.center.lng.toFixed(6)})`;

  const clauses: string[] = [];
  for (const venue of venues) {
    for (const tag of tags) clauses.push(`  nwr${venue}${tag}${around};`);
  }

  return [
    `[out:json][timeout:${OVERPASS_TIMEOUT_S}];`,
    "(",
    ...clauses,
    ");",
    `out center ${MAX_ELEMENTS};`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Reading an element
// ---------------------------------------------------------------------------

/** `https://www.openstreetmap.org/node/123` — our constant plus a Zod-validated
 *  non-negative integer id. Nothing from the response reaches the path. */
function elementUrl(element: OverpassElement): string {
  return `https://www.openstreetmap.org/${element.type}/${element.id}`;
}

function coordsOf(
  element: OverpassElement,
): { lat: number; lng: number } | undefined {
  const lat = element.lat ?? element.center?.lat;
  const lng = element.lon ?? element.center?.lon;
  if (typeof lat !== "number" || typeof lng !== "number") return undefined;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return undefined;
  return { lat, lng };
}

/** `addr:*` tags, joined the way the rest of the app writes an address. Only
 *  the street line plus the city — `canonicalKey` keys on the first street
 *  token, so a fuller address does not help it and a differently-ordered one
 *  would hurt. */
function addressOf(tags: Record<string, string>): string | undefined {
  const street = [tags["addr:housenumber"], tags["addr:street"]]
    .filter((part) => part && part.trim() !== "")
    .join(" ");
  const city = tags["addr:city"] ?? tags["addr:suburb"];
  const parts = [street, city].filter((part) => part && part.trim() !== "");
  return parts.length > 0 ? parts.join(", ") : undefined;
}

/**
 * Deterministic evidence for one place.
 *
 * No LLM, and therefore no fabricated-quote problem to guard against: the quote
 * is the tag itself, written out as `key=value`, which is verbatim source text
 * by construction rather than by a substring check on model output.
 */
export function evidenceForTags(args: {
  tags: Record<string, string>;
  requirements: readonly PlannedRequirement[];
  uiLocale: UiLocale;
  sourceUrl: string;
}): Evidence[] {
  const out: Evidence[] = [];
  for (const requirement of args.requirements) {
    const tagging = requirement.catalogId
      ? REQUIREMENT_TAGS[requirement.catalogId]
      : undefined;
    if (!tagging) continue;
    const key = tagging.key(requirement);
    if (!key) continue;
    const value = args.tags[key];
    if (value === undefined) continue;
    // An open vocabulary: read only the values we have a documented meaning
    // for. `diet:gluten_free=ask_staff` is real and says something, but not
    // something this table can state, so it is skipped rather than guessed.
    const reading = tagging.readings[value.trim().toLowerCase()];
    if (!reading) continue;
    const phrase = VALUE_PHRASES[value.trim().toLowerCase()]?.[args.uiLocale];
    if (!phrase) continue;

    out.push(
      EvidenceSchema.parse({
        requirementId: requirement.id,
        claim: `${requirement.label} — ${phrase}`,
        polarity: reading.polarity,
        // Verbatim source text: this is exactly how the tag is written.
        quote: `${key}=${value}`,
        source: OSM_SOURCE,
        sourceUrl: args.sourceUrl,
        // `check_date` is OSM's own "a human verified this on" tag. When it is
        // there it is far better provenance than the dossier usually gets.
        date: isoDate(args.tags["check_date"]),
        confidence: reading.confidence,
      }),
    );
  }
  return out;
}

const OSM_SOURCE = "openstreetmap";

/** `check_date` is free text in practice; keep it only when it is an ISO date. */
function isoDate(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  return /^\d{4}-\d{2}-\d{2}$/.test(raw.trim()) ? raw.trim() : undefined;
}

/** One Overpass element -> one finding, or nothing when it is unusable. */
export function findingForElement(
  element: OverpassElement,
  args: {
    requirements: readonly PlannedRequirement[];
    uiLocale: UiLocale;
  },
): PlaceFinding | undefined {
  const tags = element.tags ?? {};
  const name = tags["name"]?.trim();
  // An unnamed venue cannot be merged with a Google Maps result, cannot be
  // shown to a user, and cannot be visited. Nothing useful is lost by skipping.
  if (!name) return undefined;

  const sourceUrl = elementUrl(element);
  const evidence = evidenceForTags({
    tags,
    requirements: args.requirements,
    uiLocale: args.uiLocale,
    sourceUrl,
  });
  // Every element came back because it matched a tag filter, so an element with
  // no readable evidence means its value is outside the documented vocabulary.
  // It contributes nothing and would only take a slot.
  if (evidence.length === 0) return undefined;

  const address = addressOf(tags);
  const coords = coordsOf(element);
  // `website` is a tag someone typed; it becomes an `href` in the dossier.
  const website = tags["website"] ?? tags["contact:website"];
  // `image=` is OSM's documented key for a photograph of the feature. Rarely
  // set, free when it is — the element was already fetched — and it is a real
  // second photo provider for a place Google Maps has no carousel for.
  // Someone typed it, so it goes through the same gate as every other scraped
  // URL before it can be stored and later fetched on a reader's behalf.
  const image = safePhotoUrl(tags["image"]);

  return {
    place: PlaceDetailSchema.parse({
      name,
      address,
      category: tags["cuisine"] ?? tags["amenity"] ?? tags["shop"],
      phone: tags["phone"] ?? tags["contact:phone"],
      url: website && isSafeSiteUrl(website) ? website : undefined,
      thumbnailUrl: image,
      lat: coords?.lat,
      lng: coords?.lng,
      canonicalKey: canonicalKey(name, address),
    }),
    source: {
      source: OSM_SOURCE,
      sourceUrl,
      // OSM has no ratings or reviews, and inventing a proxy for them (tag
      // count, edit count) would be a number that looks like a rating and is
      // not one. Left absent; the dossier already renders that.
    },
    evidence,
  };
}

// ---------------------------------------------------------------------------
// Network
// ---------------------------------------------------------------------------

/**
 * Where to centre the search.
 *
 * Prefers coordinates the job already carries — the form's forward geocode got
 * there first. Falls back to one Nominatim lookup of the location text, with
 * the same coarse-match guard `/api/geocode` uses, because the form
 * deliberately withholds coordinates whenever a postal code is present (a
 * postal code is finer than anything the text geocode resolves, and Google is
 * the only geocoder in this stack that can read one). The neighbourhood
 * centroid is more than good enough for a few-kilometre radius.
 */
async function resolveCenter(
  ctx: AdapterContext,
): Promise<{ lat: number; lng: number } | undefined> {
  if (typeof ctx.location.lat === "number" && typeof ctx.location.lng === "number") {
    return { lat: ctx.location.lat, lng: ctx.location.lng };
  }

  const query = locationText(ctx.location);
  if (query === "") return undefined;

  // URL built ONLY from the hardcoded constant plus validated params.
  const upstream = new URL(NOMINATIM_SEARCH_URL);
  upstream.searchParams.set("format", "jsonv2");
  upstream.searchParams.set("q", query);
  upstream.searchParams.set("limit", "1");
  const country = ctx.location.country;
  if (country && /^[A-Za-z]{2}$/.test(country)) {
    upstream.searchParams.set("countrycodes", country.toLowerCase());
  }

  try {
    const res = await ctx.fetch(upstream, {
      headers: { "user-agent": USER_AGENT, accept: "application/json" },
      // A followed redirect would walk the request off the allowlisted origin.
      redirect: "error",
      signal: AbortSignal.timeout(NOMINATIM_TIMEOUT_MS),
    });
    if (!res.ok) {
      await ctx.log("debug", `Nominatim returned HTTP ${res.status}`);
      return undefined;
    }
    const body: unknown = await res.json();
    const hit = Array.isArray(body)
      ? (body[0] as Record<string, unknown> | undefined)
      : undefined;
    if (!hit) return undefined;
    const lat = Number(hit["lat"]);
    const lng = Number(hit["lon"]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return undefined;
    if (isCoarseBoundingBox(hit["boundingbox"])) {
      await ctx.log(
        "debug",
        `Nominatim matched "${query}" to a region too large to search — no OSM centre`,
      );
      return undefined;
    }
    return { lat, lng };
  } catch (err) {
    await ctx.log("debug", `Nominatim lookup failed (${describeError(err)})`);
    return undefined;
  }
}

/** Query text for the geocode hop. The postal code is deliberately omitted:
 *  Nominatim has no Canadian postal data at all (Canada Post licenses it), so
 *  including it only makes a resolvable neighbourhood query unresolvable. */
function locationText(location: Location): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const part of [location.query, location.city, location.region, location.countryName]) {
    const value = part?.trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    if (parts.some((existing) => existing.toLowerCase().includes(key))) continue;
    seen.add(key);
    parts.push(value);
  }
  return parts.join(", ");
}

/** POST the query to Overpass. Throws on any non-2xx or transport failure; the
 *  caller turns that into the fixture fallback. */
async function callOverpass(
  ctx: AdapterContext,
  query: string,
): Promise<z.infer<typeof OverpassResponseSchema>> {
  const res = await ctx.fetch(OVERPASS_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": USER_AGENT,
      accept: "application/json",
    },
    body: new URLSearchParams({ data: query }).toString(),
    redirect: "error",
    signal: AbortSignal.timeout(OVERPASS_FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Overpass returned HTTP ${res.status}`);
  return OverpassResponseSchema.parse(await res.json());
}

let cachedFixture: z.infer<typeof FixtureFileSchema> | undefined;
function loadFixture(): z.infer<typeof FixtureFileSchema> {
  if (!cachedFixture) {
    const raw = readFileSync(fileURLToPath(FIXTURE_URL), "utf8");
    cachedFixture = FixtureFileSchema.parse(JSON.parse(raw));
  }
  return cachedFixture;
}

// ---------------------------------------------------------------------------
// The adapter
// ---------------------------------------------------------------------------

export const openStreetMapAdapter: Adapter = {
  id: OSM_SOURCE,
  // Derived from the filter table rather than restated, so adding an intent
  // there is the whole change.
  supports: (intentId) => INTENT_FILTERS[intentId] !== undefined,
  // An HTTP read, not a browsing session. Worth stating: this is what keeps a
  // run from paying for a recorded Solari session it would never open a page in.
  needsBrowser: false,

  async run(ctx: AdapterContext): Promise<AdapterResult> {
    const startedAt = Date.now();
    const intentIds = ctx.intentIds.filter((id) => INTENT_FILTERS[id] !== undefined);

    // Checked BEFORE anything is fetched, because it needs nothing fetched and
    // because it is a complete answer rather than a data problem: "OSM has no
    // tag for what you asked" is not something a fixture could stand in for.
    // Worth an `info` — it is the one outcome here a user could act on.
    if (
      venueFilters(intentIds).length === 0 ||
      searchableTagFilters(ctx.requirements).length === 0
    ) {
      await ctx.log(
        "info",
        "nothing in this run maps to an OpenStreetMap tag — skipping " +
          "(OSM has no allergen or rental-condition tagging)",
      );
      return { findings: [], mode: "live" };
    }

    const center = await resolveCenter(ctx);

    // Same contract as the browser adapters: a source that cannot be reached —
    // for want of a centre or for want of a network — degrades to its recorded
    // fixture and SAYS SO, so the dossier's sample-data strip fires instead of
    // the run silently looking thinner.
    const fallBackToFixture = async (
      why: string,
    ): Promise<z.infer<typeof FixtureFileSchema> | undefined> => {
      await ctx.log("warn", `${why} — using recorded sample data`);
      try {
        return loadFixture();
      } catch (err) {
        await ctx.log("warn", `fixture unreadable (${describeError(err)})`);
        return undefined;
      }
    };

    let response: z.infer<typeof OverpassResponseSchema> | undefined;
    let mode: SourceMode = "live";
    // The point every place is measured from when ordering the results. The
    // fixture carries the centre it was recorded around, so a fixture run still
    // sorts coherently instead of against wherever the user actually asked.
    let sortCenter = center;

    if (center) {
      const query = buildOverpassQuery({
        intentIds,
        requirements: ctx.requirements,
        center,
        radiusKm: ctx.location.radiusKm,
      });
      try {
        if (ctx.signal.aborted) throw new Error("AbortError");
        if (!query) throw new Error("no query to run");
        await ctx.log(
          "debug",
          `querying Overpass around ${center.lat.toFixed(4)},${center.lng.toFixed(4)} ` +
            `within ${ctx.location.radiusKm} km`,
        );
        response = await callOverpass(ctx, query);
      } catch (err) {
        const fixture = await fallBackToFixture(
          `Overpass unavailable (${describeError(err)})`,
        );
        if (!fixture) return { findings: [], mode: "fixture" };
        response = fixture.response;
        sortCenter = fixture.center ?? center;
        mode = "fixture";
      }
    } else {
      const fixture = await fallBackToFixture(
        "could not resolve a searchable centre for this location",
      );
      if (!fixture) return { findings: [], mode: "fixture" };
      response = fixture.response;
      sortCenter = fixture.center;
      mode = "fixture";
    }

    const findings: PlaceFinding[] = [];
    const seen = new Set<string>();
    for (const element of response.elements) {
      const finding = findingForElement(element, {
        requirements: ctx.requirements,
        uiLocale: ctx.uiLocale,
      });
      if (!finding) continue;
      // The union query can match the same element through more than one
      // clause, and a chain can appear as several nearby nodes.
      if (seen.has(finding.place.canonicalKey)) continue;
      seen.add(finding.place.canonicalKey);
      findings.push(finding);
    }

    // Closest first, then truncate. Every place here carries coordinates, so
    // distance is exact — unlike the Maps adapter, which ranks on evidence
    // because half its results have no coordinates until enrichment. The one
    // case `sortCenter` is absent is a fixture with no recorded centre, where
    // the recorded order stands.
    if (sortCenter) {
      const from = sortCenter;
      findings.sort((a, b) => distanceFrom(from, a) - distanceFrom(from, b));
    }

    await ctx.log(
      "info",
      `${response.elements.length} OpenStreetMap element(s) → ${findings.length} tagged place(s) ` +
        `in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`,
    );
    ctx.reportProgress?.({ fraction: 1 });
    return { findings: findings.slice(0, ctx.limit), mode };
  },
};

/** Squared-ish ordering key; the exact metric does not matter for a sort and
 *  this avoids a haversine per comparison. */
function distanceFrom(
  center: { lat: number; lng: number },
  finding: PlaceFinding,
): number {
  const { lat, lng } = finding.place;
  if (typeof lat !== "number" || typeof lng !== "number") return Number.MAX_VALUE;
  const dLat = lat - center.lat;
  // Longitude degrees shrink with latitude; without this a sort near the poles
  // would weight east-west distance far too heavily.
  const dLng = (lng - center.lng) * Math.cos((center.lat * Math.PI) / 180);
  return dLat * dLat + dLng * dLng;
}

/** Test seam: the module-level fixture cache would otherwise leak between tests. */
export function __resetFixtureCache(): void {
  cachedFixture = undefined;
}

export type { FetchLike };
