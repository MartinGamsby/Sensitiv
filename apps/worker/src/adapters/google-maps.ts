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
// reports diagnostics (final URL, title, consent/captcha detection) so a 0-card
// run says WHY instead of just being silent — see the adapter's `run()` below.
const SCRAPE_FN = `() => {
  try {
    const selectors = ${CARD_SELECTORS_JS};
    let cards = [];
    for (const sel of selectors) {
      const found = document.querySelectorAll(sel);
      if (found.length > 0) { cards = Array.from(found); break; }
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
      diagnostics: { url: location.href, title: document.title, consentPage: consentPage, captchaPage: captchaPage },
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
});
const ScrapeBlobSchema = z.object({
  results: z.array(z.unknown()).default([]),
  diagnostics: ScrapeDiagnosticsSchema.optional(),
});

function mapsSearchUrl(query: string, searchLangCode: string, country?: string): string {
  const params = new URLSearchParams();
  if (searchLangCode) params.set("hl", searchLangCode);
  if (country) params.set("gl", country);
  const qs = params.toString();
  return `https://www.google.com/maps/search/${encodeURIComponent(query)}${qs ? `?${qs}` : ""}`;
}

const FEED_WAIT_TIMEOUT_MS = 6_000;
const FEED_POLL_INTERVAL_MS = 400;

/** Bounded poll for the results feed instead of a flat delay, so a slow load
 *  is not mistaken for a selector miss. `BrowserPage` exposes no "wait for
 *  selector" of its own (deliberately no typing/locator API — see
 *  `../browser/solari.ts`), so this is a short `evaluate` + `waitForTimeout`
 *  loop, capped at ~6s and checking the job's abort signal each iteration. */
async function waitForFeed(page: BrowserPage, signal: AbortSignal): Promise<void> {
  const deadline = Date.now() + FEED_WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (signal.aborted) return;
    const found = await page.evaluate<boolean>(FEED_PROBE_FN);
    if (found) return;
    await page.waitForTimeout(FEED_POLL_INTERVAL_MS);
  }
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
          await waitForFeed(page, ctx.signal);
          const blob = await page.evaluate<unknown>(SCRAPE_FN);
          const parsedBlob = ScrapeBlobSchema.safeParse(blob);
          const results = parsedBlob.success ? parsedBlob.data.results : [];
          const diagnostics = parsedBlob.success ? parsedBlob.data.diagnostics : undefined;

          // The observability gap this section exists to close: an LLM faithfully
          // extracting `{ places: [] }` from an empty blob looks identical, in the
          // old logs, to a selector miss or a consent wall. This line — and the
          // finding-count line below — are what tell them apart on the next run.
          await ctx.log("debug", `query "${query}" → ${results.length} raw card(s)`);
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
