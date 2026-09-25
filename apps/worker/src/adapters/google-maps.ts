// The one real adapter. Registry, launch, query, navigation and replay plumbing
// are real; extraction is fixture-backed whenever the browser is a
// `FixtureBrowserSession` (i.e. no Solari key). Google Maps is listed under all
// four intents, so `supports` is always true.
//
// The live path runs in three stages, and the first two exist because of a real
// run that went badly wrong (job 8150b7c4, "Italian" + celiac, postal code H1S):
//
//   1. ANCHOR. Resolve the search location to a map viewport ONCE, then pin
//      every search to it with the `/@lat,lng,<z>z` URL segment. Without that
//      segment Google picks the viewport from the query text, and it picked
//      `@46.18,-72.42,9z` — a province-wide view centred in farmland — for a
//      Montreal postal code, returning Quebec City restaurants 250 km away.
//      The postal code was in the query text and Google simply ignored it.
//   2. DEPTH. Scroll the results feed. Maps lazy-loads it: one `evaluate` after
//      load sees ~6 places, scrolling to exhaustion sees ~22. In that same run
//      the expected top result sat at index 15 and could never have been found.
//   3. ENRICH. A result card is ~600 characters of name, rating, category and
//      one review line. It cannot settle "dedicated gluten-free kitchen", so
//      almost every place came back `unclear` on the requirement the user
//      actually cared about. For places left unverified on a heavy requirement,
//      open the place's own Maps page (and, failing that, its website) and
//      extract again from something that might actually say.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  viewportFor,
  type Location,
  type PlannedRequirement,
  type Viewport,
} from "@sensitiv/shared";
import {
  ExtractionSchema,
  buildFindingsFromExtraction,
  extractFindings,
} from "../extract.ts";
import { normalizeText } from "../merge.ts";
import {
  bestCaseScore,
  scorePlace,
  unverifiedRequirements,
  type ScoreOptions,
} from "@sensitiv/shared";
import type {
  Adapter,
  AdapterContext,
  AdapterProgress,
  AdapterResult,
  PlaceFinding,
} from "./types.ts";
import type { BrowserPage } from "../browser/solari.ts";
import {
  chunk,
  describeError,
  isSafeSiteUrl,
  mapWithConcurrency,
  safePhotoUrl,
  sleep,
} from "../util.ts";

const FIXTURE_URL = new URL(
  "../../fixtures/google-maps-plateau.json",
  import.meta.url,
);

const THROTTLE_MS = 1_000; // ≥ 1 s between page loads — see the robots/ToS note in the README

const FixtureFileSchema = z.object({
  sourceUrl: z.string().optional(),
  blob: z.unknown(),
  extraction: ExtractionSchema,
});

// Result-card selector cascade: tried in order, first non-empty match wins.
// `[role="article"]` (the original, kept last) turned out to be a guess — Maps
// does not reliably tag result cards with it. The feed-row and place-anchor
// selectors above it are the more stable handles seen in practice. Shared
// between the page-side functions below so they never drift apart.
const CARD_SELECTORS = [
  'div[role="feed"] > div > div[jsaction]',
  'a[href*="/maps/place/"][aria-label]',
  ".Nv2PK",
  '[role="article"]',
] as const;
const CARD_SELECTORS_JS = JSON.stringify(CARD_SELECTORS);

// Page-side "has the results feed shown up yet" probe, for the bounded wait
// that replaces a flat `waitForTimeout`.
//
// IIFE, not a bare arrow function: `BrowserPage.evaluate` forwards this string
// straight to the real (Playwright-based) `Page.evaluate`, whose string form
// is `eval`-style — it evaluates the STRING AS AN EXPRESSION, it does not
// detect "this looks like a function" and call it. `evaluate("() => true")`
// evaluates to the function value itself, which cannot cross the wire and
// resolves to `undefined` — silently, on every call, regardless of what's on
// the page. `evaluate("(() => true)()")` evaluates the call expression, which
// runs the body and returns a real, serializable result. Every page-side
// string here must be wrapped this way.
const FEED_PROBE_FN = `(() => {
  const selectors = ${CARD_SELECTORS_JS};
  return selectors.some((sel) => document.querySelectorAll(sel).length > 0);
})()`;

/** Read back the URL Maps settled on. Maps rewrites `location.href` to include
 *  the viewport it resolved (`/@lat,lng,<z>z`) a moment after the SPA loads, so
 *  this is polled rather than read once. */
const HREF_FN = `(() => location.href)()`;

// Page-side feed scroll. Scrolls the feed container (NOT the window — the feed
// is its own overflow region) to the bottom and reports how many cards exist
// right now. The caller loops: scroll, wait for the lazy load, scroll again,
// stop when the count stops growing.
const SCROLL_FEED_FN = `(() => {
  try {
    const selectors = ${CARD_SELECTORS_JS};
    const feed = document.querySelector('div[role="feed"]');
    const count = () => {
      for (const sel of selectors) {
        const n = document.querySelectorAll(sel).length;
        if (n > 0) return n;
      }
      return 0;
    };
    if (!feed) return { count: count(), scrollable: false };
    feed.scrollTo(0, feed.scrollHeight);
    return { count: count(), scrollable: true };
  } catch (e) { return { count: 0, scrollable: false }; }
})()`;

// Page-side card count, polled while a scroll's lazy load lands. Same tier
// order as the scroll itself, so the two can never disagree about the count.
const COUNT_FN = `(() => {
  try {
    const tiers = ${CARD_SELECTORS_JS};
    for (const sel of tiers) {
      const n = document.querySelectorAll(sel).length;
      if (n > 0) return n;
    }
    return 0;
  } catch (e) { return 0; }
})()`;

// Page-side results extractor: deliberately tiny and tolerant — returns
// `{ results: [] }` rather than throwing on a selector miss. (Only runs on the
// live path.) Also reports diagnostics (final URL, title, consent/captcha
// detection, and a per-tier `querySelectorAll` count for every entry in
// `CARD_SELECTORS`) so a 0-card run says WHY instead of just being silent.
//
// `rawCount` is the true DOM-match count for the tier that won, BEFORE the
// name-extraction filter — kept separate from `results.length` (the named,
// post-filter count) because collapsing the two hid a real failure mode: cards
// present in the DOM but `name` extraction finding nothing on all of them
// looked identical, in the logs, to the DOM having no cards at all.
//
// A card must carry a `/maps/place/` link to count. That link is both the
// identity check and the handle stage 3 needs to reopen the place. It also
// drops the one piece of chrome that kept polluting every single run: the
// filter-chip row is a `div[jsaction]` feed child like any other, and its
// `aria-label` ("Filters available for this search") sailed through as a place
// name straight into the LLM prompt.
const SCRAPE_FN = `(() => {
  try {
    const selectors = ${CARD_SELECTORS_JS};
    let cards = [];
    const tierCounts = [];
    for (const sel of selectors) {
      const found = document.querySelectorAll(sel);
      tierCounts.push(found.length);
      if (cards.length === 0 && found.length > 0) { cards = Array.from(found); }
    }
    const out = [];
    let chrome = 0;
    for (const card of cards) {
      const isAnchor = card.matches && card.matches('a[href*="/maps/place/"]');
      const nameAnchor = isAnchor ? card : card.querySelector('a[href*="/maps/place/"]');
      if (!nameAnchor) { chrome++; continue; }
      const name =
        card.getAttribute('aria-label') ||
        nameAnchor.getAttribute('aria-label') ||
        (card.querySelector('.qBF1Pd') && card.querySelector('.qBF1Pd').textContent) ||
        '';
      if (!name) { chrome++; continue; }
      const ratingEl =
        card.querySelector('[role="img"][aria-label*="star"]') ||
        card.querySelector('span[aria-label$="stars"]') ||
        card.querySelector('.MW4etd');
      let rating;
      if (ratingEl) {
        const raw = ratingEl.getAttribute('aria-label') || ratingEl.textContent || '';
        const m = raw.match(/(\\d+[.,]\\d+|\\d+)/);
        if (m) rating = parseFloat(m[1].replace(',', '.'));
      }
      const text = card.innerText || '';
      // Largest Google-hosted photo on the card. Cards also carry a 40x40
      // gstatic reviewer-avatar placeholder, which is why this filters by host
      // and takes the biggest rather than the first.
      let thumb = '';
      let thumbArea = 0;
      for (const img of card.querySelectorAll('img')) {
        const src = img.src || '';
        if (src.indexOf('https://') !== 0) continue;
        if (src.indexOf('.googleusercontent.com/') < 0) continue;
        const area = (img.naturalWidth || 0) * (img.naturalHeight || 0);
        if (area >= thumbArea) { thumbArea = area; thumb = src; }
      }
      out.push({
        name: name,
        url: nameAnchor.href,
        thumbnailUrl: thumb,
        rating: rating,
        // Paid placement. Passed through rather than dropped (it is a real
        // business), but labelled so the extractor is not told an ad is the
        // top organic answer.
        sponsored: /Sponsored|Commandit/i.test(text),
        snippet: text.slice(0, 600),
      });
    }
    const consentPage = /consent\\.google\\./.test(location.href) || !!document.querySelector('form[action*="consent"]');
    const captchaPage = /sorry\\/index/.test(location.href);
    return {
      results: out.slice(0, 40),
      rawCount: cards.length,
      chromeCount: chrome,
      diagnostics: { url: location.href, title: document.title, consentPage: consentPage, captchaPage: captchaPage, tierCounts: tierCounts },
    };
  } catch (e) { return { results: [] }; }
})()`;

// Page-side place-detail extractor (stage 3). The detail panel carries what a
// result card cannot: the full address, the official website, the editorial
// summary, service attributes, and — the useful part — Maps' review-topic chips,
// whose `aria-label`s read like "gluten free, mentioned in 89 reviews". Those
// are quantified, quotable evidence for exactly the kind of requirement this
// app exists to check.
//
// The topic filter matches "<digits> … reviews/avis" in either UI language
// rather than any requirement vocabulary: WHAT is being asked about comes from
// the catalog and must never be hardcoded here.
const PLACE_FN = `(() => {
  try {
    const one = (sel) => document.querySelector(sel);
    const main = one('div[role="main"]');
    const labels = Array.from(document.querySelectorAll('[aria-label]'))
      .map((e) => e.getAttribute('aria-label') || '')
      .filter((t) => t.length > 0 && t.length < 240);
    const reviewTopics = [];
    const seenTopic = {};
    for (const label of labels) {
      if (!/\\d/.test(label)) continue;
      if (!/(avis|reviews?)/i.test(label)) continue;
      if (seenTopic[label]) continue;
      seenTopic[label] = 1;
      reviewTopics.push(label);
    }
    let hero = '';
    let heroArea = 0;
    for (const img of document.querySelectorAll('img')) {
      const src = img.src || '';
      if (src.indexOf('https://') !== 0) continue;
        if (src.indexOf('.googleusercontent.com/') < 0) continue;
      const area = (img.naturalWidth || 0) * (img.naturalHeight || 0);
      if (area >= heroArea) { heroArea = area; hero = src; }
    }
    const website = one('a[data-item-id="authority"]');
    const address = one('button[data-item-id="address"]');
    const phone = one('button[data-item-id^="phone"]');
    const h1 = one('h1');
    return {
      title: (h1 && h1.textContent) || '',
      address: (address && address.getAttribute('aria-label')) || '',
      phone: (phone && phone.getAttribute('aria-label')) || '',
      website: (website && website.href) || '',
      thumbnailUrl: hero,
      reviewTopics: reviewTopics.slice(0, 30),
      text: ((main && main.innerText) || document.body.innerText || '').slice(0, 5000),
      url: location.href,
    };
  } catch (e) { return { error: String((e && e.message) || e) }; }
})()`;

// Page-side generic page text, for the official-website hop of stage 3.
const SITE_FN = `(() => {
  try {
    const pick = document.querySelector('main') || document.querySelector('article') || document.body;
    // The site's own picture of itself. A restaurant that Maps has no photo
    // for almost always has one here, because og:image is what it wanted
    // shown when someone shares the page. Absolute-ised against the document
    // so a relative path is still usable; the worker re-validates the result.
    let image = '';
    const metaKeys = [
      'meta[property="og:image"]',
      'meta[property="og:image:url"]',
      'meta[name="twitter:image"]',
      'meta[name="twitter:image:src"]',
      'link[rel="image_src"]',
    ];
    for (const key of metaKeys) {
      const el = document.querySelector(key);
      const raw = el && (el.getAttribute('content') || el.getAttribute('href'));
      if (raw) {
        try { image = new URL(raw, location.href).href; } catch (e) { image = ''; }
        if (image) break;
      }
    }
    return {
      title: document.title || '',
      url: location.href,
      image: image,
      text: ((pick && pick.innerText) || '').slice(0, 6000),
    };
  } catch (e) { return { error: String((e && e.message) || e) }; }
})()`;

/** Test-only escape hatch onto the page-side strings above. The only way to
 *  guard against silently reintroducing the missing-IIFE bug (a bare
 *  `"() => {...}"` string evaluates, under real `Page.evaluate`, to a Function
 *  value that can't cross the wire) is to actually run these strings through
 *  `eval` the way Playwright does, not just pattern-match their text — see
 *  `google-maps.test.ts`. */
export const __pageFunctionsForTest = {
  FEED_PROBE_FN,
  SCRAPE_FN,
  SCROLL_FEED_FN,
  COUNT_FN,
  PLACE_FN,
  SITE_FN,
  HREF_FN,
};

// What the page-side functions report back. `results` items stay `unknown` —
// they are forwarded to the LLM extraction step as-is, never parsed here.
const ScrapeDiagnosticsSchema = z.object({
  url: z.string().optional(),
  title: z.string().optional(),
  consentPage: z.boolean().optional(),
  captchaPage: z.boolean().optional(),
  // One count per `CARD_SELECTORS` entry, in order — always computed, not just
  // for the tier that "won" — so a 0-result run can be read back as "the DOM
  // truly had nothing" vs. "a looser tier matched something the tighter one
  // didn't" without needing another live run to find out.
  tierCounts: z.array(z.number()).optional(),
});
const ScrapeResultSchema = z.object({
  name: z.string(),
  url: z.string().optional(),
  thumbnailUrl: z.string().optional(),
  rating: z.number().optional(),
  sponsored: z.boolean().optional(),
  snippet: z.string().optional(),
});
const ScrapeBlobSchema = z.object({
  results: z.array(ScrapeResultSchema).default([]),
  rawCount: z.number().optional(),
  chromeCount: z.number().optional(),
  diagnostics: ScrapeDiagnosticsSchema.optional(),
});
const ScrollBlobSchema = z.object({
  count: z.number().default(0),
  scrollable: z.boolean().default(false),
});
const PlaceBlobSchema = z.object({
  title: z.string().default(""),
  /** `og:image` off the place's own website — the stage-3 photo fallback. */
  image: z.string().default(""),
  address: z.string().default(""),
  phone: z.string().default(""),
  website: z.string().default(""),
  thumbnailUrl: z.string().default(""),
  reviewTopics: z.array(z.string()).default([]),
  text: z.string().default(""),
  url: z.string().default(""),
});

function mapsSearchUrl(
  query: string,
  searchLangCode: string,
  country?: string,
  viewport?: Viewport,
): string {
  const params = new URLSearchParams();
  if (searchLangCode) params.set("hl", searchLangCode);
  if (country) params.set("gl", country);
  const qs = params.toString();
  // The `/@lat,lng,<z>z` segment is what actually pins the map. Six decimal
  // places is ~10 cm — far more than enough, and it keeps the URL readable in
  // the replay.
  const anchor = viewport
    ? `/@${viewport.lat.toFixed(6)},${viewport.lng.toFixed(6)},${viewport.zoom}z`
    : "";
  return `https://www.google.com/maps/search/${encodeURIComponent(query)}${anchor}${qs ? `?${qs}` : ""}`;
}

/**
 * The string handed to Maps to resolve the viewport.
 *
 * Postal code FIRST when there is one, because it is the most specific thing
 * the user gave and Google is the only geocoder in this stack that knows it:
 * OpenStreetMap/Nominatim has no Canadian postal data at all (Canada Post
 * licenses it), so `/api/geocode` returns nothing for "H1S" however it is
 * phrased. Google resolves "H1S, Canada" to Montreal's Saint-Léonard without
 * being told the city.
 */
export function locationProbe(location: Location): string {
  const parts = location.postalCode
    ? [location.postalCode, location.city, location.region, location.countryName]
    : [location.query, location.city, location.region, location.countryName];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of parts) {
    const value = part?.trim();
    if (!value) continue;
    const key = normalizeText(value);
    if (key === "" || seen.has(key)) continue;
    // Skip a part the query already names ("Montreal" inside "Montreal, QC").
    if (out.some((existing) => normalizeText(existing).includes(key))) continue;
    seen.add(key);
    out.push(value);
  }
  return out.join(", ");
}

const VIEWPORT_RE = /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(\d+(?:\.\d+)?)z/;

/** Parse the `@lat,lng,<z>z` segment Maps writes back into the address bar. */
export function parseViewport(href: string): Viewport | undefined {
  const m = VIEWPORT_RE.exec(href);
  if (!m) return undefined;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  const zoom = Number(m[3]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(zoom)) {
    return undefined;
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return undefined;
  return { lat, lng, zoom };
}

// A cold Maps load (fresh session, no cached tiles/JS, geocoding the query
// before it can render a single card) was observed taking several seconds
// past what a 6s bound gave it — every query in that run logged a full
// timeout, not a partial one. 20s is still bounded (worst case 3 queries ×
// 20s ≈ 1 minute of a 480s job budget) but gives the SPA room to actually
// settle before we give up and call it a selector/consent problem.
const FEED_WAIT_TIMEOUT_MS = 20_000;
const FEED_POLL_INTERVAL_MS = 400;

/** How long to wait for Maps to rewrite the URL with the viewport it resolved. */
const VIEWPORT_WAIT_TIMEOUT_MS = 12_000;

/** Feed scrolling: how many rounds, and the longest to wait for each lazy load.
 *  ~22 results is where a Montreal restaurant search stops growing, so 10
 *  rounds is generous; the loop exits on the first round that adds nothing.
 *
 *  The wait is a ceiling, not a sleep. Each round polls for the new cards and
 *  moves on when they land, so only the last round (the one that finds nothing
 *  new) waits the full time. */
const MAX_SCROLL_ROUNDS = 10;
const SCROLL_SETTLE_MS = 1_400;
const SCROLL_POLL_MS = 200;
const MAX_FEED_RESULTS = 30;

/**
 * Extraction batching.
 *
 * Profiling a real run: one query's 32 places went to the LLM as a single call
 * and took 134.5 s, out of a 400 s run. Extraction was ~90% of the whole job
 * and every call was strictly sequential.
 *
 * Splitting the results into batches buys two things. Smaller prompts return
 * faster and more reliably — asking for careful per-place evidence across 32
 * places at once is where a model starts skimping — and independent batches can
 * run at the same time. Concurrency is deliberately modest: these are paid
 * calls, and the point is to stop serialising, not to flood.
 */
const EXTRACTION_BATCH_SIZE = 8;
const EXTRACTION_CONCURRENCY = 3;

/** Stage 3 caps. Every enrichment is a page load on a paid, recorded session,
 *  so the work is bounded by count, not just by the job budget. Raised from 6
 *  now that the queue only holds places with a REAL open question: narrowing
 *  enrichment to catalog requirements cut the candidate list far more than this
 *  raises it. */
const MAX_ENRICH_PLACES = 10;
/**
 * How many places to enrich at once, each in its own tab.
 *
 * Sequential enrichment was 203.8 s of a 400 s run — ten places at ~20 s each,
 * and most of that is the LLM call, not the page load. Three tabs in one
 * session is ordinary browsing; the per-worker `THROTTLE_MS` still paces each
 * one, so the aggregate request rate stays close to what a person generates.
 * Deliberately not higher: this is a paid, recorded session on a site that
 * rate-limits, and the win from 1 -> 3 is most of the win available.
 */
const ENRICH_CONCURRENCY = 3;
/**
 * How many searches to run at once, each in its own tab. Same reasoning and
 * the same ceiling as `ENRICH_CONCURRENCY`: the searches are independent page
 * loads, and running them one after another left two idle tabs' worth of
 * waiting on every deep run's scroll loop. Starts are staggered by
 * `THROTTLE_MS` so the tabs do not hit Maps in the same instant.
 */
const SEARCH_CONCURRENCY = 3;
const PLACE_WAIT_TIMEOUT_MS = 15_000;
const SITE_LOAD_TIMEOUT_MS = 15_000;

/**
 * Bounded poll, for the several "wait until the SPA has rendered X" cases.
 * `BrowserPage` exposes no "wait for selector" of its own (deliberately no
 * typing/locator API — see `../browser/solari.ts`), so waiting means an
 * `evaluate` + `waitForTimeout` loop.
 *
 * Capped by BOTH a wall-clock deadline and an attempt count. The attempt count
 * is not redundant: `waitForTimeout` comes off the injected page, so a test
 * fake (where it returns instantly) turns a deadline-only loop into a busy spin
 * that burns the full timeout of CPU and blows the test's own budget. Bounding
 * attempts also bounds the work on a real page, which is the honest thing for
 * something running against a paid session.
 *
 * Returns the first defined probe value, or nothing if it never came.
 */
async function pollFor<T>(
  page: BrowserPage,
  signal: AbortSignal,
  opts: {
    timeoutMs: number;
    intervalMs: number;
    probe: () => Promise<T | undefined>;
  },
): Promise<{ value?: T; elapsedMs: number }> {
  const start = Date.now();
  const maxAttempts = Math.max(1, Math.ceil(opts.timeoutMs / opts.intervalMs));
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (signal.aborted) break;
    if (attempt > 0 && Date.now() - start >= opts.timeoutMs) break;
    const value = await opts.probe();
    if (value !== undefined) return { value, elapsedMs: Date.now() - start };
    await page.waitForTimeout(opts.intervalMs);
  }
  return { elapsedMs: Date.now() - start };
}

/** Wait for the results feed, so a slow load is not mistaken for a selector
 *  miss. Reports how long it took so `run()` can log a real number instead of
 *  just "found" / "gave up". */
async function waitForFeed(
  page: BrowserPage,
  signal: AbortSignal,
): Promise<{ found: boolean; elapsedMs: number }> {
  const { value, elapsedMs } = await pollFor(page, signal, {
    timeoutMs: FEED_WAIT_TIMEOUT_MS,
    intervalMs: FEED_POLL_INTERVAL_MS,
    probe: async () => ((await page.evaluate<boolean>(FEED_PROBE_FN)) ? true : undefined),
  });
  return { found: value === true, elapsedMs };
}

/**
 * Stage 1. Ask Maps where the search location is, and read the viewport it
 * resolved back out of the address bar.
 *
 * Skipped entirely when there is no postal code and the `Location` already
 * carries coordinates — the form's forward geocode got there first and a page
 * load would buy nothing. A postal code beats GEOCODED coordinates, because
 * those are coarser than a postal code by definition and Google is the only
 * source in this stack that can read one.
 *
 * A PINNED location beats everything, including the postal code: the user
 * pointed at a spot on a map, which is finer than a delivery area, and nothing
 * this hop could resolve would be an improvement on it.
 */
async function resolveViewport(
  page: BrowserPage,
  ctx: AdapterContext,
): Promise<Viewport | undefined> {
  const fromLocation = viewportFor(ctx.location);
  if (fromLocation && (ctx.location.pinned || !ctx.location.postalCode)) {
    await ctx.log(
      "debug",
      `viewport from ${ctx.location.pinned ? "the map pin" : "geocoded location"}: ` +
        `${fromLocation.lat.toFixed(4)},${fromLocation.lng.toFixed(4)} @${fromLocation.zoom}z`,
    );
    return fromLocation;
  }

  const probe = locationProbe(ctx.location);
  if (probe === "") return fromLocation;

  try {
    await ctx.log("debug", `resolving location "${probe}"`);
    await page.goto(mapsSearchUrl(probe, ctx.searchLang.code, ctx.location.country), {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });

    const { value: parsed } = await pollFor(page, ctx.signal, {
      timeoutMs: VIEWPORT_WAIT_TIMEOUT_MS,
      intervalMs: FEED_POLL_INTERVAL_MS,
      probe: async () => {
        const href = await page.evaluate<string>(HREF_FN);
        return typeof href === "string" ? parseViewport(href) : undefined;
      },
    });
    if (parsed) {
      // Google's own zoom describes the feature it matched (an FSA comes back
      // at 14z); the user's radius is what they actually asked for, so keep
      // Google's centre and our zoom.
      const zoom = viewportFor({ ...ctx.location, lat: parsed.lat, lng: parsed.lng })?.zoom;
      const viewport: Viewport = { ...parsed, zoom: zoom ?? parsed.zoom };
      await ctx.log(
        "info",
        `location "${probe}" resolved to ${viewport.lat.toFixed(4)},${viewport.lng.toFixed(4)} @${viewport.zoom}z`,
      );
      return viewport;
    }
    await ctx.log(
      "warn",
      `could not resolve a map viewport for "${probe}" — searches will carry the location as text instead`,
    );
  } catch (err) {
    await ctx.log(
      "warn",
      `location resolve failed (${describeError(err)}) — searches will carry the location as text instead`,
    );
  }
  return fromLocation;
}

/**
 * Stage 2. Scroll the results feed until it stops growing.
 *
 * Maps renders roughly the first six results and lazy-loads the rest on scroll.
 * Reading the DOM once after load is therefore a hard cap at ~6 places per
 * query, which is how a 4.2-star Italian restaurant with 1,694 reviews, two
 * blocks from the requested postal code, failed to appear in an Italian
 * restaurant search: it was result 15.
 */
async function scrollFeed(
  page: BrowserPage,
  signal: AbortSignal,
  target: number,
): Promise<number> {
  let best = 0;
  for (let round = 0; round < MAX_SCROLL_ROUNDS; round++) {
    if (signal.aborted) break;
    const raw = await page.evaluate<unknown>(SCROLL_FEED_FN);
    const parsed = ScrollBlobSchema.safeParse(raw);
    if (!parsed.success) break;
    const { count, scrollable } = parsed.data;
    if (!scrollable) return count;
    // Growth is what justifies another round; the first round that adds nothing
    // means the feed is exhausted.
    if (round > 0 && count <= best) return count;
    best = Math.max(best, count);
    if (best >= target) return best;
    await pollFor(page, signal, {
      timeoutMs: SCROLL_SETTLE_MS,
      intervalMs: SCROLL_POLL_MS,
      probe: async () => {
        const now = await page.evaluate<unknown>(COUNT_FN);
        return typeof now === "number" && now > count ? now : undefined;
      },
    });
  }
  return best;
}

let cachedFixture: z.infer<typeof FixtureFileSchema> | undefined;
function loadFixture(): z.infer<typeof FixtureFileSchema> {
  if (!cachedFixture) {
    const raw = readFileSync(fileURLToPath(FIXTURE_URL), "utf8");
    cachedFixture = FixtureFileSchema.parse(JSON.parse(raw));
  }
  return cachedFixture;
}

/** Bounded wait for a place panel to render its heading. */
async function waitForPlace(
  page: BrowserPage,
  signal: AbortSignal,
): Promise<boolean> {
  const { value } = await pollFor(page, signal, {
    timeoutMs: PLACE_WAIT_TIMEOUT_MS,
    intervalMs: FEED_POLL_INTERVAL_MS,
    probe: async () => {
      const parsed = PlaceBlobSchema.safeParse(await page.evaluate<unknown>(PLACE_FN));
      return parsed.success && parsed.data.title.trim() !== "" ? true : undefined;
    },
  });
  return value === true;
}

/**
 * Stage 3. For each place still unverified on a heavy requirement, open its
 * Maps detail page — and, if that still does not settle the question, its
 * official website — and extract again.
 *
 * Evidence is appended to the EXISTING finding rather than emitted as a new
 * one: a detail page reports a fuller address than the result card, and letting
 * that through `canonicalKey` would split one place into two.
 */
async function enrichFindings(
  ctx: AdapterContext,
  findings: PlaceFinding[],
  placeUrls: Map<string, string>,
  report: (update: AdapterProgress) => void,
  tabs: Tabs,
  scoreOptions: (finding: PlaceFinding) => ScoreOptions,
): Promise<void> {
  const enrichBase = STAGE_SHARE.resolve + STAGE_SHARE.scrape + STAGE_SHARE.extract;
  // Whatever happens below, this stage's share is spent by the time we return —
  // including the early exits, which would otherwise strand the bar.
  const finishStage = (): void => {
    report({ fraction: enrichBase + STAGE_SHARE.enrich });
  };

  const researchable = enrichableRequirements(ctx.requirements);
  if (researchable.length === 0) {
    finishStage();
    return;
  }

  const candidates: Array<{ finding: PlaceFinding; url: string; missing: string }> = [];
  for (const finding of findings) {
    const missing = unverifiedRequirements(finding.evidence, researchable);
    if (missing.length === 0) continue;
    const url = placeUrls.get(normalizeText(finding.place.name));
    if (!url) continue;
    candidates.push({
      finding,
      url,
      missing: missing.map((r) => r.label).join(", "),
    });
  }
  if (candidates.length === 0) {
    finishStage();
    return;
  }

  // Most promising first. "Promising" is the preliminary score, broken by
  // review count: a place with more reviews has more for the detail page to
  // say, which is the entire reason we are opening it.
  const rank = (c: { finding: PlaceFinding }): number =>
    scorePlace(c.finding.evidence, {
      requirements: ctx.requirements,
      // No centre here on purpose — this ranks which pages are worth OPENING,
      // and proximity is not a reason to read a page. The category is, though:
      // it is often all a result card gives us about the kind of place.
      place: c.finding.place,
    }).score;
  candidates.sort((a, b) => {
    const byScore = rank(b) - rank(a);
    if (byScore !== 0) return byScore;
    return (b.finding.source.reviewCount ?? 0) - (a.finding.source.reviewCount ?? 0);
  });

  const queue = candidates.slice(0, MAX_ENRICH_PLACES);
  await ctx.log(
    "info",
    `${candidates.length} place(s) left unverified by the results page; opening ${queue.length}`,
  );
  // The moment the run learns how much work is actually left. Until now the
  // total was unknowable — it depends on how many places the searches turned
  // up and how many of them the results page failed to settle.
  report({ fraction: enrichBase, done: 0, total: queue.length, unit: "place" });

  // The skip rule. A place only earns a page load if what the page says could
  // still get it into the `ctx.limit` this adapter returns. `finalScores` holds
  // every score that can no longer change: places that were never queued,
  // places already enriched, and places already skipped. If `ctx.limit` of
  // those beat a candidate's best case (every planned requirement confirmed at
  // full confidence), then no page could get it into the results, and opening
  // one is time spent on a place the dossier will not show. This compares
  // against a ceiling, not a guess, so it never drops a place that could have
  // placed. It also gets stricter as the run goes: each place enriched adds a
  // final score for the next check.
  const queued = new Set(queue.map((c) => c.finding));
  const finalScoreOf = (f: PlaceFinding): number =>
    scorePlace(f.evidence, scoreOptions(f)).score;
  const finalScores = findings.filter((f) => !queued.has(f)).map(finalScoreOf);
  const couldStillPlace = (f: PlaceFinding): boolean => {
    const ceiling = bestCaseScore(f.evidence, scoreOptions(f), "google_maps");
    return finalScores.filter((s) => s > ceiling).length < ctx.limit;
  };

  let opened = 0;
  let skipped = 0;
  const tick = (): void => {
    opened += 1;
    report({
      fraction: enrichBase + STAGE_SHARE.enrich * (opened / queue.length),
      done: opened,
      total: queue.length,
      unit: "place",
    });
  };
  const pages = await tabsFor(ctx, tabs, Math.min(ENRICH_CONCURRENCY, queue.length));
  await mapOnPages(pages, queue, async (candidate, workerPage) => {
    if (!couldStillPlace(candidate.finding)) {
      skipped += 1;
      await ctx.log(
        "debug",
        `${candidate.finding.place.name}: not opened — ${ctx.limit} place(s) already ` +
          `outscore the best its pages could give it`,
      );
      finalScores.push(finalScoreOf(candidate.finding));
      tick();
      return;
    }
    await enrichOne(workerPage, ctx, candidate, researchable, {
      couldStillPlace: () => couldStillPlace(candidate.finding),
      onDone: tick,
    });
    finalScores.push(finalScoreOf(candidate.finding));
  });
  if (skipped > 0) {
    await ctx.log(
      "info",
      `skipped ${skipped} of ${queue.length} place page(s): they could not reach the top ` +
        `${ctx.limit} whatever those pages said`,
    );
  }
  finishStage();
}

/**
 * Enrich a single place: its Maps detail page, then its official website if
 * that still left a restriction unsettled.
 *
 * Never throws. One place failing must not stop the others now that these run
 * concurrently, and `onDone` fires on every path so the progress bar advances
 * for a place that timed out exactly as it does for one that succeeded — it is
 * one fewer thing the user is waiting on either way.
 */
async function enrichOne(
  page: BrowserPage,
  ctx: AdapterContext,
  candidate: { finding: PlaceFinding; url: string; missing: string },
  researchable: readonly PlannedRequirement[],
  hooks: {
    /** Re-checked before the website hop, because other places finished
     *  while this one's detail page loaded. */
    couldStillPlace: () => boolean;
    onDone: () => void;
  },
): Promise<void> {
  const onDone = hooks.onDone;
  const name = candidate.finding.place.name;
  if (ctx.signal.aborted) {
    onDone();
    return;
  }
  try {
    await sleep(THROTTLE_MS);
    await ctx.log("debug", `opening ${name} for: ${candidate.missing}`);
    const [, navMs] = await timed(() =>
      page.goto(candidate.url, { waitUntil: "domcontentloaded", timeout: 30_000 }),
    );
    if (!(await waitForPlace(page, ctx.signal))) {
      await ctx.log("debug", `${name}: detail page did not render in time`);
      return;
    }
    const parsed = PlaceBlobSchema.safeParse(await page.evaluate<unknown>(PLACE_FN));
    if (!parsed.success) return;
    const detail = parsed.data;

    // Fallback photo: only when the results card had none. The card's is
    // preferred simply because every place gets one, enriched or not.
    candidate.finding.place.thumbnailUrl ??= safeThumbnailUrl(detail.thumbnailUrl);

    const [added, extractMs] = await timed(() =>
      extractInto(candidate.finding, { place: detail }, {
        ctx,
        sourceUrl: detail.url || candidate.url,
      }),
    );
    await ctx.log(
      "debug",
      `${name}: detail page added ${added} evidence item(s)` +
        (detail.reviewTopics.length > 0
          ? ` (${detail.reviewTopics.length} review topic(s))`
          : "") +
        ` — load ${secs(navMs)}, extract ${secs(extractMs)}`,
    );

    // Website hop. Two reasons to take it now: a requirement the detail page
    // did not settle, OR no photo yet. The second one is new and it is worth
    // a page load on its own — a card with no picture is the one a reader
    // skips past, and `og:image` is a restaurant's own picture of itself, so
    // it is there precisely when Google's carousel had nothing.
    const stillMissing = unverifiedRequirements(candidate.finding.evidence, researchable);
    const needsPhoto = candidate.finding.place.thumbnailUrl === undefined;
    if (stillMissing.length === 0 && !needsPhoto) return;
    if (!detail.website || !isSafeSiteUrl(detail.website)) return;
    if (ctx.signal.aborted) return;
    if (!hooks.couldStillPlace()) {
      await ctx.log(
        "debug",
        `${name}: skipping its website — it can no longer reach the top ${ctx.limit}`,
      );
      return;
    }

    await sleep(THROTTLE_MS);
    const why =
      stillMissing.length > 0
        ? `for ${stillMissing.map((r) => r.label).join(", ")}`
        : "for a photo";
    await ctx.log("debug", `${name}: trying its website ${why}`);
    try {
      await page.goto(detail.website, {
        waitUntil: "domcontentloaded",
        timeout: SITE_LOAD_TIMEOUT_MS,
      });
      const site = PlaceBlobSchema.pick({
        title: true,
        text: true,
        url: true,
        image: true,
      }).safeParse(await page.evaluate<unknown>(SITE_FN));
      if (!site.success) return;

      // Take the photo even from a page whose text was empty: an image-heavy
      // single-page site with no extractable prose is exactly the kind that
      // still has a good `og:image`.
      candidate.finding.place.thumbnailUrl ??= safePhotoUrl(site.data.image);

      if (site.data.text.trim() === "") return;
      // A photo-only hop ends here. Every catalog requirement is already
      // settled, and the free-text subject is not worth an extraction (see
      // `enrichableRequirements`), so reading the site text would be an LLM
      // call that changes nothing we rank on.
      if (stillMissing.length === 0) return;
      const siteAdded = await extractInto(
        candidate.finding,
        {
          place: {
            ...site.data,
            image: undefined,
            name,
            website: detail.website,
          },
        },
        { ctx, sourceUrl: detail.website },
      );
      await ctx.log("debug", `${name}: website added ${siteAdded} evidence item(s)`);
    } catch (err) {
      await ctx.log("debug", `${name}: website unreachable (${describeError(err)})`);
    }
  } catch (err) {
    await ctx.log(
      "debug",
      `${name}: enrichment failed (${describeError(err)}) — keeping what we have`,
    );
  } finally {
    onDone();
  }
}

async function extractInto(
  finding: PlaceFinding,
  blob: unknown,
  args: { ctx: AdapterContext; sourceUrl: string },
): Promise<number> {
  const built = await extractFindings(blob, {
    source: "google_maps",
    sourceUrl: args.sourceUrl,
    requirements: args.ctx.requirements,
    uiLocale: args.ctx.uiLocale,
    searchLang: args.ctx.searchLang,
    llm: args.ctx.llm,
    cache: args.ctx.extractionCache,
    signal: args.ctx.signal,
    log: args.ctx.log,
  });

  let added = 0;
  // Structural key, not string concatenation with a separator. Deliberately NOT
  // a literal NUL: one in a source file makes git treat the whole file as
  // binary (`queries.ts` carries the same note after the same mistake).
  const keyOf = (e: { requirementId: string; polarity: string; quote: string }): string =>
    JSON.stringify([e.requirementId, e.polarity, e.quote]);
  const seen = new Set(finding.evidence.map(keyOf));
  for (const extra of built) {
    for (const item of extra.evidence) {
      const key = keyOf(item);
      if (seen.has(key)) continue;
      seen.add(key);
      finding.evidence.push(item);
      added += 1;
    }
  }
  if (!finding.place.url) {
    const withUrl = built.find((b) => b.place.url);
    if (withUrl?.place.url) finding.place.url = withUrl.place.url;
  }
  return added;
}

/**
 * Coordinates out of a Google Maps place URL.
 *
 * Maps encodes them in the `data=` blob as `!3d<lat>!4d<lng>`. Reading them
 * here rather than leaving it to the extractor is both more reliable and
 * cheaper: the model was already recovering them, but only because the URL
 * happened to be in the blob we handed it, and asking a language model to copy
 * eleven significant figures out of a URL is a coin flip we do not need to
 * take. These feed the score's proximity term, so a wrong digit moves ranking.
 */
export function parsePlaceCoords(
  url: string | undefined,
): { lat: number; lng: number } | undefined {
  if (!url) return undefined;
  const m = /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/.exec(url);
  if (!m) return undefined;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return undefined;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return undefined;
  return { lat, lng };
}

/** Seconds, one decimal — the resolution a human reads a timing at. */
function secs(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

/** Run `fn`, returning its value and how long it took. */
async function timed<T>(fn: () => Promise<T>): Promise<[T, number]> {
  const startedAt = Date.now();
  const value = await fn();
  return [value, Date.now() - startedAt];
}

/**
 * Validate and normalise a place photo URL scraped off a page.
 *
 * This value becomes an `<img src>` in the dossier, so it is third-party output
 * heading straight for the DOM. Only absolute https on a Google user-content
 * host is accepted; anything else — another origin, a `javascript:` or `data:`
 * URI, a relative path — is dropped rather than cleaned up.
 *
 * Google serves these with a size suffix describing the slot they were rendered
 * in, and a result card's slot is ~80x106. Rewriting it asks for something
 * worth looking at; the suffix is Google's own documented sizing syntax, not a
 * query string we invented.
 */
export function safeThumbnailUrl(raw: string | undefined): string | undefined {
  const safe = safePhotoUrl(raw);
  if (safe === undefined) return undefined;
  const url = new URL(safe);
  if (!/^[a-z0-9-]+\.googleusercontent\.com$/.test(url.hostname.toLowerCase())) {
    // Not a Google photo host: no size suffix to rewrite, but still a photo
    // this adapter is allowed to keep. The host restriction used to live here
    // and was the reason a place Maps had no carousel for showed nothing at
    // all; the render-side gate that made it necessary is now a server-side
    // proxy (`/api/jobs/:id/places/:key/photo`).
    return safe;
  }
  // `=w80-h106-k-no` -> `=w400-h300-k-no`, leaving a suffix-less URL alone.
  return url.href.replace(/=w\d+-h\d+([-\w]*)$/, `=w${THUMBNAIL_WIDTH}-h${THUMBNAIL_HEIGHT}$1`);
}

const THUMBNAIL_WIDTH = 400;
const THUMBNAIL_HEIGHT = 300;

/**
 * A Maps listing URL, or nothing.
 *
 * The scrape reads one off each result card's `a[href*="/maps/place/"]`, and
 * it is a far better citation than the SEARCH url the extraction pass falls
 * back to: the dossier's source chip says "Google Maps · Rating 4.6", and a
 * reader who follows it should land on that place, not on a results page they
 * have to find it in again.
 *
 * Gated like every other scraped URL this adapter keeps. `google.` covers the
 * country domains Maps redirects to (`google.ca`, `google.fr`) without
 * accepting `google.evil.test`.
 */
export function mapsPlaceUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:") return undefined;
  const host = url.hostname.toLowerCase();
  if (!/^(www.)?google.[a-z.]{2,7}$/.test(host)) return undefined;
  return url.pathname.includes("/maps/place/") ? url.href : undefined;
}

/**
 * The requirements worth opening a page to research.
 *
 * ONLY the ones the user explicitly picked from the catalog. The free-text
 * subject ("Italian") is already answered by the search itself: it IS the query
 * Google matched on, so a place in the results is Italian by construction and
 * re-litigating it on the restaurant's own website is pure waste. A real run
 * spent five of its six page loads hunting "Cuisine italienne" on the websites
 * of gluten-free bakeries.
 *
 * What a website genuinely adds is the dietary/accessibility detail a listing
 * never carries — whether the kitchen is celiac-safe, what the allergen
 * protocol is, whether the entrance has a step. That is what this returns.
 */
function enrichableRequirements(
  requirements: readonly PlannedRequirement[],
): PlannedRequirement[] {
  return requirements.filter((r) => r.catalogId !== undefined);
}

/**
 * Put back what the result card said deterministically, over whatever the model
 * read out of it: the photo, the coordinates and the listing URL.
 */
function attachCardFacts(
  finding: PlaceFinding,
  batchUrl: string,
  card: {
    placeUrls: ReadonlyMap<string, string>;
    placeThumbnails: ReadonlyMap<string, string>;
    searchUrlOf: ReadonlyMap<string, string>;
  },
): void {
  const key = normalizeText(finding.place.name);
  finding.place.thumbnailUrl ??= card.placeThumbnails.get(key);
  // Overwrite, not `??=`: a deterministic parse of the URL beats whatever the
  // model read out of it.
  const cardUrl = card.placeUrls.get(key);
  const coords = parsePlaceCoords(cardUrl);
  if (coords) {
    finding.place.lat = coords.lat;
    finding.place.lng = coords.lng;
  }
  // Cite the LISTING, not the search that found it. "Google Maps · Rating 4.6"
  // is a dead end when following it lands the reader back on a results page.
  // Enrichment overwrites this again with the detail page's own URL for the
  // places it opens; this covers the ones it does not.
  const listing = mapsPlaceUrl(cardUrl);
  // Without a listing, cite the search that listed THIS place. A batch mixes
  // places from several searches, so the batch's URL may be another search's.
  const cite = listing ?? (finding.source.sourceUrl === batchUrl ? card.searchUrlOf.get(key) : undefined);
  if (cite) {
    finding.source.sourceUrl = cite;
    for (const item of finding.evidence) item.sourceUrl = cite;
  }
}

/**
 * Collapse findings that are the same place, across queries.
 *
 * A celiac + "Italian" run issues two searches, and anything matching both
 * appears in both result sets. Without this the same restaurant arrives twice
 * with half its evidence each, competes with itself for a slot, and loses to
 * places that only matched one query. The runner merges across SOURCES later;
 * this is the within-source pass that has to happen before ranking.
 */
function dedupeByPlace(findings: readonly PlaceFinding[]): PlaceFinding[] {
  const byKey = new Map<string, PlaceFinding>();
  for (const finding of findings) {
    const key = finding.place.canonicalKey;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...finding, evidence: [...finding.evidence] });
      continue;
    }
    const seen = new Set(
      existing.evidence.map((e) => JSON.stringify([e.requirementId, e.polarity, e.quote])),
    );
    for (const item of finding.evidence) {
      const key2 = JSON.stringify([item.requirementId, item.polarity, item.quote]);
      if (seen.has(key2)) continue;
      seen.add(key2);
      existing.evidence.push(item);
    }
    // Keep the fuller record: a second sighting often carries an address or a
    // review count the first one lacked.
    if (!existing.place.address && finding.place.address) {
      existing.place.address = finding.place.address;
    }
    if (!existing.place.url && finding.place.url) existing.place.url = finding.place.url;
    if (!existing.place.thumbnailUrl && finding.place.thumbnailUrl) {
      existing.place.thumbnailUrl = finding.place.thumbnailUrl;
    }
    if (existing.source.reviewCount === undefined) {
      existing.source.reviewCount = finding.source.reviewCount;
    }
    if (existing.source.rating === undefined) existing.source.rating = finding.source.rating;
  }
  return [...byKey.values()];
}

/**
 * How the adapter's own 0..1 progress splits across its three stages.
 *
 * Re-measured off a real 400-second run (resolve 5.9s, searches 190.5s, enrich
 * 203.8s): resolving the
 * viewport is one page load, each query is a load plus up to ~27 lazy-load
 * scrolls plus an LLM extraction, and each enrichment is one or two loads plus
 * another extraction. Enrichment gets the largest share because it is the only
 * stage whose cost scales with how many places were found.
 *
 * Being wrong here makes the bar uneven, never incorrect: the stage boundaries
 * are still reported exactly when they happen.
 */
//
// Searches are split in two now that they no longer run one at a time: the
// scrapes run in parallel tabs and are short, then every distinct card goes
// through one concurrent extraction pass.
const STAGE_SHARE = {
  resolve: 0.03,
  scrape: 0.12,
  extract: 0.3,
  enrich: 0.52,
  finish: 0.03,
} as const;

/**
 * The run's tabs. `newPage()` on a live session opens a tab in the same
 * browser context, so cookies and whatever consent state Google set on the
 * first load are shared. A fresh context per search or place would negotiate
 * all of that again and look much less like one person browsing.
 *
 * Opened on demand and shared by stage 2 and stage 3. `run()` closes them all.
 */
interface Tabs {
  open: BrowserPage[];
  /** The session refused a tab once, so it is not asked again. */
  refused: boolean;
}

/** Up to `n` tabs, opening more only as needed. A session that will not open
 *  another tab is not a reason to fail: the tabs we already have each take on
 *  more of the work. */
async function tabsFor(ctx: AdapterContext, tabs: Tabs, n: number): Promise<BrowserPage[]> {
  while (tabs.open.length < n && !tabs.refused) {
    try {
      tabs.open.push(await ctx.browser.newPage());
    } catch {
      tabs.refused = true;
    }
  }
  return tabs.open.slice(0, Math.max(1, n));
}

/**
 * Run `worker` over `items`, one per tab at a time, and give each call a tab
 * no other call is using.
 *
 * Deliberately not `pages[index % pages.length]`. That was how enrichment
 * picked its tab, and it is only correct while calls finish in the order they
 * started. When a later place finished first, its worker picked up the next
 * index, and that index mapped onto a tab that was still loading someone
 * else's page.
 */
async function mapOnPages<T, R>(
  pages: readonly BrowserPage[],
  items: readonly T[],
  worker: (item: T, page: BrowserPage, index: number) => Promise<R>,
): Promise<R[]> {
  const free = [...pages];
  return mapWithConcurrency(items, pages.length, async (item, index) => {
    // Never empty: at most `pages.length` calls are in flight.
    const page = free.pop() as BrowserPage;
    try {
      return await worker(item, page, index);
    } finally {
      free.push(page);
    }
  });
}

type ScrapedCard = z.infer<typeof ScrapeResultSchema>;

/** One search's scrape: the cards on its page, and the URL they came from. */
interface ScrapedSearch {
  url: string;
  cards: ScrapedCard[];
}

/** A card as the extractor sees it: one per place, however many searches
 *  listed it. */
type MergedCard = ScrapedCard & { otherSnippets?: string[] };

/** The Maps feature id in a listing URL (`!1s0x…:0x…`). */
const FEATURE_ID_RE = /!1s(0x[0-9a-f]+:0x[0-9a-f]+)/i;

/**
 * One card per place, across every search, BEFORE any model sees them.
 *
 * A celiac + "Italian" run lists the same restaurant under both searches.
 * Each search used to send it to the model on its own: two paid extractions
 * of one place, and then `dedupeByPlace` threw half of that work away. Merging
 * the cards first means each place is asked about once.
 *
 * A second sighting's snippet is kept when it differs. Maps picks a card's
 * review line to match the search, so the "Italian" card and the "gluten free"
 * card for one restaurant can quote different reviews, and the second may be
 * the only one that mentions gluten. Each snippet stays its own string, so the
 * quote guard still refuses a quote stitched together across the two.
 *
 * Identity is the feature id in the listing URL, which tells two branches of a
 * chain apart. The name is only a fallback for when the URL has no id.
 */
export function mergeCards(searches: readonly ScrapedSearch[]): {
  cards: MergedCard[];
  /** The search each place was first listed by, keyed by normalised name. */
  searchUrlOf: Map<string, string>;
} {
  const byId = new Map<string, MergedCard>();
  const searchUrlOf = new Map<string, string>();
  for (const search of searches) {
    for (const card of search.cards) {
      const featureId = card.url ? FEATURE_ID_RE.exec(card.url)?.[1] : undefined;
      const id = featureId
        ? `id:${featureId.toLowerCase()}`
        : `name:${normalizeText(card.name)}`;
      const name = normalizeText(card.name);
      if (!searchUrlOf.has(name)) searchUrlOf.set(name, search.url);
      const existing = byId.get(id);
      if (!existing) {
        byId.set(id, { ...card });
        continue;
      }
      const snippet = card.snippet?.trim();
      if (
        snippet &&
        snippet !== existing.snippet?.trim() &&
        !existing.otherSnippets?.includes(snippet)
      ) {
        (existing.otherSnippets ??= []).push(snippet);
      }
      if (!existing.thumbnailUrl && card.thumbnailUrl) existing.thumbnailUrl = card.thumbnailUrl;
      existing.rating ??= card.rating;
      // Organic on any search means it is a real result, not only an ad.
      if (existing.sponsored && !card.sponsored) existing.sponsored = card.sponsored;
    }
  }
  return { cards: [...byId.values()], searchUrlOf };
}

/**
 * Stage 2 for one query: load the results page, wait for the feed, scroll it
 * (full search only) and read the cards off it. No model is involved, so
 * several of these can run at once in separate tabs.
 *
 * Never throws. A query that fails logs why and contributes no cards.
 */
async function scrapeSearch(
  page: BrowserPage,
  ctx: AdapterContext,
  query: string,
  url: string,
  quick: boolean,
): Promise<ScrapedSearch> {
  try {
    const [, navMs] = await timed(() =>
      page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 }),
    );
    const feedWait = await waitForFeed(page, ctx.signal);
    await ctx.log(
      "debug",
      `query "${query}" feed wait: ${feedWait.found ? "found" : "timed out"} after ${feedWait.elapsedMs}ms`,
    );

    // Quick search stops at what the first screen already holds. The scroll
    // loop is the single biggest thing this adapter can skip: it costs its own
    // rounds AND everything they uncover, since each place it lazy-loads is
    // another place to extract and enrich.
    const [scrolled, scrollMs] = await timed(async () =>
      feedWait.found && !quick
        ? await scrollFeed(
            page,
            ctx.signal,
            Math.min(MAX_FEED_RESULTS, Math.max(ctx.limit * 3, 20)),
          )
        : 0,
    );

    const [blob, scrapeMs] = await timed(() => page.evaluate<unknown>(SCRAPE_FN));
    const parsedBlob = ScrapeBlobSchema.safeParse(blob);
    const results = parsedBlob.success ? parsedBlob.data.results : [];
    const diagnostics = parsedBlob.success ? parsedBlob.data.diagnostics : undefined;
    // `rawCount` is the true DOM-match count (before the place-link and name
    // filters); older/synthetic blobs that don't set it explicitly fall back
    // to the named count, same as this adapter's original behavior.
    const rawCount = parsedBlob.success ? (parsedBlob.data.rawCount ?? results.length) : 0;
    const chromeCount = parsedBlob.success ? (parsedBlob.data.chromeCount ?? 0) : 0;

    // The observability gap this closes: an LLM faithfully extracting
    // `{ places: [] }` from an empty blob looks identical, in the old logs, to
    // a selector miss or a consent wall. These lines are what tell them apart
    // on the next run.
    await ctx.log(
      "debug",
      `query "${query}" → ${rawCount} raw card(s) ` +
        (quick ? "on the first screen (not scrolled)" : `after ${scrolled} scrolled`) +
        `, ${results.length} place(s), ${chromeCount} non-place card(s) skipped`,
    );
    if (rawCount === 0 && diagnostics?.tierCounts) {
      await ctx.log(
        "debug",
        `query "${query}" tier counts (${CARD_SELECTORS.length} selectors): ${JSON.stringify(diagnostics.tierCounts)}`,
      );
    } else if (rawCount > 0 && results.length === 0) {
      // Cards were found but every one failed the place-link/name filter — a
      // different failure than "nothing rendered", worth telling apart.
      await ctx.log(
        "warn",
        `query "${query}" found ${rawCount} card(s) but extracted 0 place(s) — card selectors likely stale`,
      );
    }
    if (diagnostics?.consentPage) {
      await ctx.log(
        "warn",
        `query "${query}" hit Google's consent interstitial — no results scraped`,
      );
    } else if (diagnostics?.captchaPage) {
      await ctx.log("warn", `query "${query}" hit Google's captcha wall — no results scraped`);
    }

    // The profile line for the page side of a query. Extraction is timed
    // separately now, because it runs for every query's cards at once.
    await ctx.log(
      "info",
      `query "${query}" took ${secs(navMs + feedWait.elapsedMs + scrollMs + scrapeMs)} ` +
        `(nav ${secs(navMs)}, feed ${secs(feedWait.elapsedMs)}, scroll ${secs(scrollMs)}, ` +
        `scrape ${secs(scrapeMs)})`,
    );
    return { url, cards: results };
  } catch (err) {
    await ctx.log("warn", `query "${query}" failed (${describeError(err)}) — moving on`);
    return { url, cards: [] };
  }
}


export const googleMapsAdapter: Adapter = {
  id: "google_maps",
  supports: () => true,
  needsBrowser: true,

  async run(ctx: AdapterContext): Promise<AdapterResult> {
    const adapterStartedAt = Date.now();
    const page = await ctx.browser.newPage();
    const tabs: Tabs = { open: [page], refused: false };
    const findings: AdapterResult["findings"] = [];

    try {
      if (ctx.browser.mode === "fixture") {
        // Deliberately does NOT name a cause: a fixture session now means "no
        // Solari key" OR "a key, but the run was gated because the LLM is not
        // working" (`allowLive` in runner.ts) OR "the launch failed". The
        // `launchBrowser` line immediately above this one already says which.
        await ctx.log("info", "using recorded fixture (no live browser session)");
        const fixture = loadFixture();
        const built = await buildFindingsFromExtraction(fixture.extraction, {
          source: "google_maps",
          sourceUrl: fixture.sourceUrl ?? "https://www.google.com/maps",
          blob: fixture.blob ?? {},
          log: ctx.log,
        });
        findings.push(...built.slice(0, ctx.limit));
        return { findings };
      }

      // A no-op when the runner did not supply one, so the adapter stays
      // runnable from a test with a two-field context.
      const report = ctx.reportProgress ?? (() => undefined);

      // --- stage 1: anchor -------------------------------------------------
      const [viewport, resolveMs] = await timed(() => resolveViewport(page, ctx));
      report({ fraction: STAGE_SHARE.resolve });

      // Maps place URL per scraped place name, for stage 3.
      const placeUrls = new Map<string, string>();
      // Photo per scraped place name. Kept OUT of the extraction blob on
      // purpose: a URL is exactly the kind of thing a model will happily
      // invent, and an invented one would be persisted and rendered. These are
      // read off the DOM and attached by name afterwards, so every stored photo
      // is one the page actually served.
      const placeThumbnails = new Map<string, string>();

      // --- stage 2: search + depth ----------------------------------------
      const seenQueries = new Set<string>();
      const searches = ctx.queries
        .filter((q) => {
          // With a viewport the location phrase is dead weight, and dropping it
          // collapses queries that differed only by that phrase.
          const text = viewport ? q.subject : q.query;
          if (text === "" || seenQueries.has(text)) return false;
          seenQueries.add(text);
          return true;
        })
        .slice(0, 3);

      // Read once, named once: stage 2 branches on it and stage 2's log lines
      // have to describe the same run it produced.
      const quick = ctx.quickSearch === true;
      await ctx.log(
        "info",
        quick
          ? "quick search — reading the first screen of results for each query (about 8 places), not scrolling for the rest"
          : "full search — scrolling each result feed until it stops growing (about 22 places)",
      );

      report({
        fraction: STAGE_SHARE.resolve,
        done: 0,
        total: searches.length,
        unit: "query",
      });
      let queriesDone = 0;
      const searchTabs = await tabsFor(
        ctx,
        tabs,
        Math.min(SEARCH_CONCURRENCY, searches.length),
      );
      // Deliberately NO `findings.length >= ctx.limit` cut-off: every planned
      // query runs. One query returns ~30 places rather than ~6, so that check
      // used to trip on the FIRST query every time: a celiac + "Italian" run
      // searched only "sans gluten restaurant", and the Italian search (the
      // user's actual subject) was never issued.
      const [scraped, scrapeMs] = await timed(() =>
        mapOnPages(searchTabs, searches, async (search, tab, index) => {
          const query = viewport ? search.subject : search.query;
          const url = mapsSearchUrl(query, ctx.searchLang.code, ctx.location.country, viewport);
          if (ctx.signal.aborted) return { url, cards: [] };
          // Stagger the first wave so the tabs do not all hit Maps at once; a
          // tab picking up a second query has just loaded a page of its own.
          await sleep(index < searchTabs.length ? THROTTLE_MS * index : THROTTLE_MS);
          await ctx.log("debug", `searching "${query}"${viewport ? " (anchored)" : ""}`);
          const result = await scrapeSearch(tab, ctx, query, url, quick);
          queriesDone += 1;
          report({
            fraction:
              STAGE_SHARE.resolve +
              STAGE_SHARE.scrape * (queriesDone / Math.max(1, searches.length)),
            done: queriesDone,
            total: searches.length,
            unit: "query",
          });
          return result;
        }),
      );

      // One card per place across every query, then one extraction pass over
      // all of them. The queries used to extract one after another, each
      // waiting on the last one's model calls, and a place two queries both
      // found was extracted twice.
      const { cards, searchUrlOf } = mergeCards(scraped);
      const sightings = scraped.reduce((n, s) => n + s.cards.length, 0);
      if (sightings !== cards.length) {
        await ctx.log(
          "debug",
          `${sightings} result(s) across ${searches.length} quer${searches.length === 1 ? "y" : "ies"} ` +
            `→ ${cards.length} distinct place(s), each extracted once`,
        );
      }
      for (const card of cards) {
        const key = normalizeText(card.name);
        if (card.url && !placeUrls.has(key)) placeUrls.set(key, card.url);
        const thumbnail = safeThumbnailUrl(card.thumbnailUrl);
        if (thumbnail && !placeThumbnails.has(key)) placeThumbnails.set(key, thumbnail);
      }

      const extractBase = STAGE_SHARE.resolve + STAGE_SHARE.scrape;
      // Nothing on the page means nothing to extract. Calling the LLM here is
      // up to two paid round trips (`extractFindings` retries once) that can
      // only ever come back `{ places: [] }`, and the raw-card lines above have
      // already said why the pages were empty.
      const batches = chunk(cards, EXTRACTION_BATCH_SIZE);
      let batchesDone = 0;
      const [batched, extractMs] = await timed(() =>
        mapWithConcurrency(batches, EXTRACTION_CONCURRENCY, async (batch) => {
          const firstKey = normalizeText(batch[0]?.name ?? "");
          const batchUrl =
            searchUrlOf.get(firstKey) ?? scraped.find((s) => s.url)?.url ?? "";
          try {
            const built = await extractFindings(
              { results: batch },
              {
                source: "google_maps",
                sourceUrl: batchUrl,
                requirements: ctx.requirements,
                uiLocale: ctx.uiLocale,
                searchLang: ctx.searchLang,
                llm: ctx.llm,
                cache: ctx.extractionCache,
                signal: ctx.signal,
                log: ctx.log,
              },
            );
            for (const finding of built) {
              attachCardFacts(finding, batchUrl, {
                placeUrls,
                placeThumbnails,
                searchUrlOf,
              });
            }
            return built;
          } catch (err) {
            await ctx.log(
              "warn",
              `extraction of ${batch.length} place(s) failed (${describeError(err)}) — moving on`,
            );
            return [];
          } finally {
            batchesDone += 1;
            report({
              fraction: extractBase + STAGE_SHARE.extract * (batchesDone / batches.length),
              done: queriesDone,
              total: searches.length,
              unit: "query",
            });
          }
        }),
      );
      report({ fraction: extractBase + STAGE_SHARE.extract });
      const built = batched.flat();
      findings.push(...built);
      await ctx.log(
        "info",
        `searches: ${searches.length} quer${searches.length === 1 ? "y" : "ies"} scraped in ` +
          `${secs(scrapeMs)} across ${searchTabs.length} tab(s); ${cards.length} place(s) ` +
          `extracted in ${secs(extractMs)} → ${built.length} finding(s)`,
      );
      if (batches.length > 1) {
        await ctx.log(
          "debug",
          `extracted in ${batches.length} batch(es), ${EXTRACTION_CONCURRENCY} at a time`,
        );
      }

      // --- stage 3: merge, enrich, rank ------------------------------------
      // The cards are already one per place, but the model can still return a
      // place twice (under two spellings of one address, say), so this pass
      // stays.
      const merged = dedupeByPlace(findings);
      if (merged.length !== findings.length) {
        await ctx.log(
          "debug",
          `${findings.length} finding(s) → ${merged.length} distinct place(s)`,
        );
      }

      // Rank BEFORE truncating. This used to be `findings.slice(0, ctx.limit)`
      // — a blind prefix of whatever order the results page happened to render
      // — which silently dropped the single place a run was looking for while
      // keeping seven that matched nothing the user asked about. Enrichment
      // scores with the same options, so the places it decides not to open are
      // judged by the ranking that will actually cut them.
      const scoreOptions = (f: PlaceFinding): ScoreOptions => ({
        requirements: ctx.requirements,
        center: viewport,
        radiusKm: ctx.location.radiusKm,
        place: f.place,
      });

      let enrichMs = 0;
      if (!ctx.signal.aborted) {
        const startedAt = Date.now();
        try {
          await enrichFindings(ctx, merged, placeUrls, report, tabs, scoreOptions);
        } catch (err) {
          await ctx.log(
            "warn",
            `enrichment pass failed (${describeError(err)}) — keeping results-page evidence`,
          );
        }
        enrichMs = Date.now() - startedAt;
      }

      const rankOf = (f: PlaceFinding): number => scorePlace(f.evidence, scoreOptions(f)).score;
      const ranked = [...merged].sort((a, b) => {
        const byScore = rankOf(b) - rankOf(a);
        if (byScore !== 0) return byScore;
        return (b.source.reviewCount ?? 0) - (a.source.reviewCount ?? 0);
      });
      report({ fraction: 1 });
      // The one line that says where a slow run went. `searches` is what the
      // per-query lines above break down; `enrich` is every detail page and
      // website hop together.
      const totalMs = Date.now() - adapterStartedAt;
      await ctx.log(
        "info",
        `timings: total ${secs(totalMs)} — resolve ${secs(resolveMs)}, ` +
          `searches ${secs(totalMs - resolveMs - enrichMs)}, enrich ${secs(enrichMs)}`,
      );
      if (ranked.length > ctx.limit) {
        await ctx.log(
          "debug",
          `keeping the ${ctx.limit} best-scoring of ${ranked.length} place(s)`,
        );
      }
      return { findings: ranked.slice(0, ctx.limit), center: viewport };
    } finally {
      for (const extra of tabs.open.slice(1)) {
        try {
          await extra.close();
        } catch {
          /* an orphaned tab dies with the session */
        }
      }
      await page.close();
    }
  },
};
