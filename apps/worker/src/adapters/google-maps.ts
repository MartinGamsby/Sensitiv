// The one real-ish adapter. Registry, launch, query, navigation and replay
// plumbing are real; extraction is fixture-backed whenever the browser is a
// `FixtureBrowserSession` (i.e. no Solari key). Google Maps is listed under all
// four intents, so `supports` is always true.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  ExtractionSchema,
  buildFindingsFromExtraction,
  extractFindings,
} from "../extract.ts";
import type { Adapter, AdapterContext, AdapterResult } from "./types.ts";
import type { BrowserPage } from "../browser/solari.ts";
import { dedupe, describeError, sleep } from "../util.ts";

const FIXTURE_URL = new URL(
  "../../fixtures/google-maps-plateau.json",
  import.meta.url,
);

const THROTTLE_MS = 1_000; // ≥ 1 s between queries — see the robots/ToS note in the README

const FixtureFileSchema = z.object({
  sourceUrl: z.string().optional(),
  blob: z.unknown(),
  extraction: ExtractionSchema,
});

// Result-card selector cascade: tried in order, first non-empty match wins.
// `[role="article"]` (the original, kept last) turned out to be a guess — Maps
// does not reliably tag result cards with it. The feed-row and place-anchor
// selectors above it are the more stable handles seen in practice. Shared
// between `SCRAPE_FN` and `FEED_PROBE_FN` below so the two never drift apart.
const CARD_SELECTORS = [
  'div[role="feed"] > div > div[jsaction]',
  'a[href*="/maps/place/"][aria-label]',
  ".Nv2PK",
  '[role="article"]',
] as const;
const CARD_SELECTORS_JS = JSON.stringify(CARD_SELECTORS);

// Page-side "has the results feed shown up yet" probe, for the bounded wait
// that replaces a flat `waitForTimeout`.
const FEED_PROBE_FN = `() => {
  const selectors = ${CARD_SELECTORS_JS};
  return selectors.some((sel) => document.querySelectorAll(sel).length > 0);
}`;

// Page-side extractor: deliberately tiny and tolerant — returns `{ results: [] }`
// rather than throwing on a selector miss. (Only runs on the live path.) Also
// reports diagnostics (final URL, title, consent/captcha detection, and a
// per-tier `querySelectorAll` count for every entry in `CARD_SELECTORS`) so a
// 0-card run says WHY instead of just being silent — see the adapter's `run()`
// below. `rawCount` is the true DOM-match count for the tier that won, BEFORE
// the name-extraction filter — kept separate from `results.length` (the named,
// post-filter count) because collapsing the two hid a real failure mode: cards
// present in the DOM but `name` extraction finding nothing on all of them
// looked identical, in the logs, to the DOM having no cards at all.
const SCRAPE_FN = `() => {
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
    for (const card of cards) {
      const nameAnchor = card.querySelector('a[href*="/maps/place/"]');
      const name = card.getAttribute('aria-label') || (nameAnchor && nameAnchor.getAttribute('aria-label')) || '';
      if (!name) continue;
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
      const linkEl = (card.matches && card.matches('a[href*="/maps/place/"]')) ? card : (nameAnchor || card.querySelector('a'));
      const link = linkEl ? linkEl.href : undefined;
      const text = card.innerText || '';
      out.push({ name: name, url: link, rating: rating, snippet: text.slice(0, 600) });
    }
    const consentPage = /consent\\.google\\./.test(location.href) || !!document.querySelector('form[action*="consent"]');
    const captchaPage = /sorry\\/index/.test(location.href);
    return {
      results: out.slice(0, 20),
      rawCount: cards.length,
      diagnostics: { url: location.href, title: document.title, consentPage: consentPage, captchaPage: captchaPage, tierCounts: tierCounts },
    };
  } catch (e) { return { results: [] }; }
}`;

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
const ScrapeBlobSchema = z.object({
  results: z.array(z.unknown()).default([]),
  rawCount: z.number().optional(),
  diagnostics: ScrapeDiagnosticsSchema.optional(),
});

function mapsSearchUrl(query: string, searchLangCode: string, country?: string): string {
  const params = new URLSearchParams();
  if (searchLangCode) params.set("hl", searchLangCode);
  if (country) params.set("gl", country);
  const qs = params.toString();
  return `https://www.google.com/maps/search/${encodeURIComponent(query)}${qs ? `?${qs}` : ""}`;
}

// A cold Maps load (fresh session, no cached tiles/JS, geocoding the query
// before it can render a single card) was observed taking several seconds
// past what a 6s bound gave it — every query in that run logged a full
// timeout, not a partial one. 20s is still bounded (worst case 3 queries ×
// 20s ≈ 1 minute of a 480s job budget) but gives the SPA room to actually
// settle before we give up and call it a selector/consent problem.
const FEED_WAIT_TIMEOUT_MS = 20_000;
const FEED_POLL_INTERVAL_MS = 400;

/** Bounded poll for the results feed instead of a flat delay, so a slow load
 *  is not mistaken for a selector miss. `BrowserPage` exposes no "wait for
 *  selector" of its own (deliberately no typing/locator API — see
 *  `../browser/solari.ts`), so this is a short `evaluate` + `waitForTimeout`
 *  loop, capped at `FEED_WAIT_TIMEOUT_MS` and checking the job's abort signal
 *  each iteration. Returns whether the feed showed up and how long that took,
 *  so `run()` can log a real number instead of just "found" / "gave up". */
async function waitForFeed(
  page: BrowserPage,
  signal: AbortSignal,
): Promise<{ found: boolean; elapsedMs: number }> {
  const start = Date.now();
  const deadline = start + FEED_WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (signal.aborted) return { found: false, elapsedMs: Date.now() - start };
    const found = await page.evaluate<boolean>(FEED_PROBE_FN);
    if (found) return { found: true, elapsedMs: Date.now() - start };
    await page.waitForTimeout(FEED_POLL_INTERVAL_MS);
  }
  return { found: false, elapsedMs: Date.now() - start };
}

let cachedFixture: z.infer<typeof FixtureFileSchema> | undefined;
function loadFixture(): z.infer<typeof FixtureFileSchema> {
  if (!cachedFixture) {
    const raw = readFileSync(fileURLToPath(FIXTURE_URL), "utf8");
    cachedFixture = FixtureFileSchema.parse(JSON.parse(raw));
  }
  return cachedFixture;
}

export const googleMapsAdapter: Adapter = {
  id: "google_maps",
  supports: () => true,
  needsBrowser: true,

  async run(ctx: AdapterContext): Promise<AdapterResult> {
    const page = await ctx.browser.newPage();
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
          blobText: JSON.stringify(fixture.blob ?? {}),
          log: ctx.log,
        });
        findings.push(...built.slice(0, ctx.limit));
        return { findings };
      }

      const queries = dedupe(ctx.queries).slice(0, 3);
      for (const query of queries) {
        if (ctx.signal.aborted) break;
        const url = mapsSearchUrl(query, ctx.searchLang.code, ctx.location.country);
        await ctx.log("debug", `searching "${query}"`);
        try {
          await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
          const feedWait = await waitForFeed(page, ctx.signal);
          const blob = await page.evaluate<unknown>(SCRAPE_FN);
          const parsedBlob = ScrapeBlobSchema.safeParse(blob);
          const results = parsedBlob.success ? parsedBlob.data.results : [];
          const diagnostics = parsedBlob.success ? parsedBlob.data.diagnostics : undefined;
          // `rawCount` is the true DOM-match count (before name extraction);
          // older/synthetic blobs that don't set it explicitly fall back to
          // the named count, same as this adapter's original behavior.
          const rawCount = parsedBlob.success ? (parsedBlob.data.rawCount ?? results.length) : 0;

          await ctx.log(
            "debug",
            `query "${query}" feed wait: ${feedWait.found ? "found" : "timed out"} after ${feedWait.elapsedMs}ms`,
          );
          // The observability gap this section exists to close: an LLM faithfully
          // extracting `{ places: [] }` from an empty blob looks identical, in the
          // old logs, to a selector miss or a consent wall. This line — and the
          // finding-count line below — are what tell them apart on the next run.
          await ctx.log("debug", `query "${query}" → ${rawCount} raw card(s), ${results.length} named`);
          if (rawCount === 0 && diagnostics?.tierCounts) {
            await ctx.log(
              "debug",
              `query "${query}" tier counts (${CARD_SELECTORS.length} selectors): ${JSON.stringify(diagnostics.tierCounts)}`,
            );
          } else if (rawCount > 0 && results.length === 0) {
            // Cards were found but every one failed name extraction — a
            // different failure than "nothing rendered", worth telling apart.
            await ctx.log(
              "warn",
              `query "${query}" found ${rawCount} card(s) but extracted 0 name(s) — name-extraction selector likely stale`,
            );
          }
          if (diagnostics?.consentPage) {
            await ctx.log(
              "warn",
              `query "${query}" hit Google's consent interstitial — no results scraped`,
            );
          } else if (diagnostics?.captchaPage) {
            await ctx.log(
              "warn",
              `query "${query}" hit Google's captcha wall — no results scraped`,
            );
          }

          // Nothing on the page means nothing to extract. Calling the LLM here
          // is up to two paid round trips (`extractFindings` retries once) that
          // can only ever come back `{ places: [] }` — and the raw-card line
          // above has already said why the page was empty, which is the whole
          // point of this section. Same reason the runner no longer opens a
          // browser for an adapter that cannot use one.
          if (results.length > 0) {
            const built = await extractFindings(
              { results },
              {
                source: "google_maps",
                sourceUrl: url,
                requirements: ctx.requirements,
                uiLocale: ctx.uiLocale,
                searchLang: ctx.searchLang,
                llm: ctx.llm,
                signal: ctx.signal,
                log: ctx.log,
              },
            );
            await ctx.log("debug", `query "${query}" → ${built.length} finding(s)`);
            findings.push(...built);
          }
        } catch (err) {
          await ctx.log("warn", `query "${query}" failed (${describeError(err)}) — moving on`);
        }
        if (findings.length >= ctx.limit) break;
        await sleep(THROTTLE_MS);
      }
      return { findings: findings.slice(0, ctx.limit) };
    } finally {
      await page.close();
    }
  },
};
