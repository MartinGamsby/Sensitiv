// Drives the LIVE branch of `googleMapsAdapter.run` through an injected
// `BrowserPage.evaluate` — never a real page. Covers the observability
// contract Section 4 added: a 0-card run must say WHY (selector miss vs
// consent/captcha wall vs extraction dropping everything), not just log
// nothing between "searching" and "0 finding(s)".
import { describe, expect, it } from "vitest";
import { FakeLlmProvider } from "@sensitiv/shared/llm";
import { LocationSchema } from "@sensitiv/shared";
import { googleMapsAdapter } from "./google-maps.ts";
import type { AdapterContext } from "./types.ts";
import type { BrowserPage, BrowserSession } from "../browser/solari.ts";
import type { JobLogLevel } from "../logger.ts";

function recorder(): {
  lines: { level: JobLogLevel; message: string }[];
  log: (level: JobLogLevel, message: string) => Promise<void>;
} {
  const lines: { level: JobLogLevel; message: string }[] = [];
  return {
    lines,
    log: (level, message) => {
      lines.push({ level, message });
      return Promise.resolve();
    },
  };
}

/** Feeds a canned blob to `SCRAPE_FN` while making the feed-wait probe (a
 *  distinct page-side function) resolve immediately, so tests do not pay the
 *  polling delay. The two are told apart by content, the only seam available
 *  — neither function is exported. */
function makeEvaluate(scrapeBlob: unknown): BrowserPage["evaluate"] {
  return (async (fn: unknown) => {
    const isFeedProbe = typeof fn === "string" && fn.includes("selectors.some(");
    return isFeedProbe ? true : scrapeBlob;
  }) as BrowserPage["evaluate"];
}

function makeLiveSession(evaluate: BrowserPage["evaluate"]): BrowserSession {
  const page: BrowserPage = {
    goto: async () => undefined,
    waitForTimeout: async () => undefined,
    evaluate,
    content: async () => "<html></html>",
    close: async () => undefined,
  };
  return {
    sessionId: "test-session",
    mode: "live",
    newPage: async () => page,
    close: async () => undefined,
    getReplayUrl: async () => undefined,
    downloadReplay: async () => undefined,
  };
}

function makeCtx(overrides: Partial<AdapterContext> = {}): AdapterContext {
  const { log } = recorder();
  return {
    jobId: "job-1",
    intentIds: ["dining"],
    location: LocationSchema.parse({
      query: "Plateau-Mont-Royal, Montreal",
      city: "Montreal",
      region: "Quebec",
      country: "CA",
    }),
    searchLang: { code: "en", source: "auto" },
    uiLocale: "en",
    requirements: [],
    queries: ["gluten free restaurant Plateau-Mont-Royal, Montreal"],
    limit: 5,
    browser: makeLiveSession(makeEvaluate({ results: [] })),
    llm: new FakeLlmProvider(),
    log,
    signal: new AbortController().signal,
    ...overrides,
  };
}

describe("googleMapsAdapter — live branch diagnostics", () => {
  it("zero raw cards: logs the raw count so it reads as a selector/consent issue, not silence", async () => {
    const { lines, log } = recorder();
    const ctx = makeCtx({
      log,
      browser: makeLiveSession(
        makeEvaluate({
          results: [],
          diagnostics: {
            url: "https://www.google.com/maps/search/x",
            title: "Google Maps",
            consentPage: false,
            captchaPage: false,
          },
        }),
      ),
    });

    const result = await googleMapsAdapter.run(ctx);

    expect(result.findings).toEqual([]);
    expect(
      lines.some((l) => l.level === "debug" && /→ 0 raw card\(s\)/.test(l.message)),
    ).toBe(true);
  });

  it("consent interstitial: warns by name and still returns cleanly", async () => {
    const { lines, log } = recorder();
    const ctx = makeCtx({
      log,
      browser: makeLiveSession(
        makeEvaluate({
          results: [],
          diagnostics: {
            url: "https://consent.google.com/m?continue=...",
            title: "Before you continue",
            consentPage: true,
            captchaPage: false,
          },
        }),
      ),
    });

    await expect(googleMapsAdapter.run(ctx)).resolves.toEqual({ findings: [] });

    expect(
      lines.some((l) => l.level === "warn" && /consent interstitial/i.test(l.message)),
    ).toBe(true);
  });

  it("captcha wall: warns by name and still returns cleanly", async () => {
    const { lines, log } = recorder();
    const ctx = makeCtx({
      log,
      browser: makeLiveSession(
        makeEvaluate({
          results: [],
          diagnostics: {
            url: "https://www.google.com/sorry/index?continue=...",
            title: "Sorry...",
            consentPage: false,
            captchaPage: true,
          },
        }),
      ),
    });

    await expect(googleMapsAdapter.run(ctx)).resolves.toEqual({ findings: [] });

    expect(
      lines.some((l) => l.level === "warn" && /captcha wall/i.test(l.message)),
    ).toBe(true);
  });

  it("cards present: logs the raw count and reaches extraction", async () => {
    const { lines, log } = recorder();
    const llm = new FakeLlmProvider();
    const ctx = makeCtx({
      log,
      llm,
      browser: makeLiveSession(
        makeEvaluate({
          results: [
            {
              name: "Test Cafe",
              url: "https://www.google.com/maps/place/x",
              rating: 4.5,
              snippet: "a fine place",
            },
          ],
          diagnostics: {
            url: "https://www.google.com/maps/search/x",
            title: "Test Cafe · Google Maps",
            consentPage: false,
            captchaPage: false,
          },
        }),
      ),
    });

    await googleMapsAdapter.run(ctx);

    expect(
      lines.some((l) => l.level === "debug" && /→ 1 raw card\(s\)/.test(l.message)),
    ).toBe(true);
    expect(llm.calls.length).toBeGreaterThan(0);
  });
});
