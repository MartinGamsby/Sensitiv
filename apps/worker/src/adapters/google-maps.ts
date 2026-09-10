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

// Page-side extractor: deliberately tiny and tolerant — returns `{ results: [] }`
// rather than throwing on a selector miss. (Only runs on the live path.)
const SCRAPE_FN = `() => {
  try {
    const out = [];
    const cards = document.querySelectorAll('[role="article"]');
    for (const card of cards) {
      const name = card.getAttribute('aria-label') || (card.querySelector('a') && card.querySelector('a').getAttribute('aria-label')) || '';
      if (!name) continue;
      const ratingEl = card.querySelector('[role="img"][aria-label*="star"]');
      const rating = ratingEl ? parseFloat(ratingEl.getAttribute('aria-label')) : undefined;
      const link = card.querySelector('a') ? card.querySelector('a').href : undefined;
      const text = card.innerText || '';
      out.push({ name: name, url: link, rating: rating, snippet: text.slice(0, 600) });
    }
    return { results: out.slice(0, 20) };
  } catch (e) { return { results: [] }; }
}`;

function mapsSearchUrl(query: string): string {
  return `https://www.google.com/maps/search/${encodeURIComponent(query)}`;
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

  async run(ctx: AdapterContext): Promise<AdapterResult> {
    const page = await ctx.browser.newPage();
    const findings: AdapterResult["findings"] = [];

    try {
      if (ctx.browser.mode === "fixture") {
        await ctx.log("info", "using recorded fixture (no Solari key)");
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
        const url = mapsSearchUrl(query);
        await ctx.log("debug", `searching "${query}"`);
        try {
          await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
          await page.waitForTimeout(1_500);
          const blob = await page.evaluate<unknown>(SCRAPE_FN);
          const built = await extractFindings(blob, {
            source: "google_maps",
            sourceUrl: url,
            requirements: ctx.requirements,
            uiLocale: ctx.uiLocale,
            searchLang: ctx.searchLang,
            llm: ctx.llm,
            signal: ctx.signal,
            log: ctx.log,
          });
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
