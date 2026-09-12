// Drives the LIVE branch of `googleMapsAdapter.run` through an injected
// `BrowserPage.evaluate` — never a real page. Covers the observability
// contract Section 4 added: a 0-card run must say WHY (selector miss vs
// consent/captcha wall vs extraction dropping everything), not just log
// nothing between "searching" and "0 finding(s)".
import { afterEach, describe, expect, it } from "vitest";
import { FakeLlmProvider } from "@sensitiv/shared/llm";
import { LocationSchema } from "@sensitiv/shared";
import { __pageFunctionsForTest, googleMapsAdapter } from "./google-maps.ts";
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

describe("page-side function strings — real Page.evaluate semantics, not the mocked one above", () => {
  // `BrowserPage.evaluate` forwards these strings straight to the real
  // (Playwright-based) `Page.evaluate`, and Playwright's string form is
  // `eval`-style: it evaluates the STRING AS AN EXPRESSION rather than
  // detecting "this looks like a function" and calling it. A bare
  // `"() => {...}"` string evaluates to the function value itself, which
  // can't be serialized back over the wire and silently resolves to
  // `undefined` — on every call, regardless of what's actually on the page.
  // `makeEvaluate()` above pattern-matches the string's *content* and hands
  // back a canned value, which is exactly how the whole test suite could
  // stay green while this was completely broken in production: it never
  // actually ran these strings through anything eval-like. This block does.
  afterEach(() => {
    Reflect.deleteProperty(globalThis, "document");
    Reflect.deleteProperty(globalThis, "location");
  });

  function installStubDom(articleCount: number): void {
    const article = {
      getAttribute: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
      matches: () => false,
      innerText: "",
    };
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        title: "Google Maps",
        querySelector: () => null,
        querySelectorAll: (sel: string) =>
          sel === '[role="article"]' ? Array.from({ length: articleCount }, () => article) : [],
      },
    });
    Object.defineProperty(globalThis, "location", {
      configurable: true,
      value: { href: "https://www.google.com/maps/search/x" },
    });
  }

  it("FEED_PROBE_FN evaluates to a real boolean, not a Function value", () => {
    installStubDom(0);
    // Intentional eval: this is exactly what real Page.evaluate(string) does.
    const result = eval(__pageFunctionsForTest.FEED_PROBE_FN);
    expect(typeof result).toBe("boolean");
    expect(result).toBe(false);
  });

  it("FEED_PROBE_FN evaluates to true once a tier matches", () => {
    installStubDom(3);
    // Intentional eval: this is exactly what real Page.evaluate(string) does.
    const result = eval(__pageFunctionsForTest.FEED_PROBE_FN);
    expect(result).toBe(true);
  });

  it("SCRAPE_FN evaluates to the results object, not a Function value", () => {
    installStubDom(0);
    // Intentional eval: this is exactly what real Page.evaluate(string) does.
    const result = eval(__pageFunctionsForTest.SCRAPE_FN) as {
      results: unknown[];
      rawCount: number;
    };
    expect(result).not.toBeInstanceOf(Function);
    expect(Array.isArray(result.results)).toBe(true);
    expect(result.rawCount).toBe(0);
  });
});

describe("googleMapsAdapter — live branch diagnostics", () => {
  it("zero raw cards: logs the raw count so it reads as a selector/consent issue, not silence", async () => {
    const { lines, log } = recorder();
    const llm = new FakeLlmProvider();
    const ctx = makeCtx({
      log,
      llm,
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
    // An empty blob can only extract to `{ places: [] }` — spending a paid
    // LLM call (twice, with the retry) to learn that is the same waste as
    // opening a browser for a stub adapter.
    expect(llm.calls.length).toBe(0);
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

  it("feed found quickly: logs how long the bounded wait actually took", async () => {
    const { lines, log } = recorder();
    const ctx = makeCtx({ log, browser: makeLiveSession(makeEvaluate({ results: [] })) });

    await googleMapsAdapter.run(ctx);

    expect(lines.some((l) => l.level === "debug" && /feed wait: found after \d+ms/.test(l.message))).toBe(
      true,
    );
  });

  it("DOM truly empty across every tier: logs the per-tier counts, not just a bare zero", async () => {
    const { lines, log } = recorder();
    const ctx = makeCtx({
      log,
      browser: makeLiveSession(
        makeEvaluate({
          results: [],
          rawCount: 0,
          diagnostics: {
            url: "https://www.google.com/maps/search/x",
            title: "Google Maps",
            consentPage: false,
            captchaPage: false,
            tierCounts: [0, 0, 0, 0],
          },
        }),
      ),
    });

    await googleMapsAdapter.run(ctx);

    expect(
      lines.some((l) => l.level === "debug" && /tier counts \(4 selectors\): \[0,0,0,0\]/.test(l.message)),
    ).toBe(true);
  });

  it("cards found in the DOM but every name extraction missed: warns distinctly from a true selector miss", async () => {
    const { lines, log } = recorder();
    const llm = new FakeLlmProvider();
    const ctx = makeCtx({
      log,
      llm,
      browser: makeLiveSession(
        makeEvaluate({
          results: [],
          rawCount: 6,
          diagnostics: {
            url: "https://www.google.com/maps/search/x",
            title: "Google Maps",
            consentPage: false,
            captchaPage: false,
            tierCounts: [6, 6, 6, 6],
          },
        }),
      ),
    });

    await googleMapsAdapter.run(ctx);

    // Distinguishable from the "DOM truly empty" case: cards existed, extraction failed.
    expect(
      lines.some(
        (l) => l.level === "warn" && /found 6 card\(s\) but extracted 0 name\(s\)/.test(l.message),
      ),
    ).toBe(true);
    // A rawCount > 0 with zero named results still means nothing to feed the LLM.
    expect(llm.calls.length).toBe(0);
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
