// Drives the LIVE branch of `googleMapsAdapter.run` through an injected
// `BrowserPage.evaluate` — never a real page. Covers the observability
// contract Section 4 added: a 0-card run must say WHY (selector miss vs
// consent/captcha wall vs extraction dropping everything), not just log
// nothing between "searching" and "0 finding(s)".
import { afterEach, describe, expect, it } from "vitest";
import { FakeLlmProvider } from "@sensitiv/shared/llm";
import { LocationSchema, type PlannedRequirement } from "@sensitiv/shared";
import {
  __pageFunctionsForTest,
  googleMapsAdapter,
  isSafeSiteUrl,
  locationProbe,
  parseViewport,
} from "./google-maps.ts";
import type { AdapterContext, AdapterProgress } from "./types.ts";
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

/** Routes each page-side function to a canned value. They are told apart by
 *  content, the only seam available — none of them is exported individually.
 *
 *  `HREF_FN` MUST return a string here: `resolveViewport` polls it until it
 *  parses or 12 s elapse, and `waitForTimeout` is a no-op in this fake, so a
 *  non-string would spin a real 12-second busy loop in every test. */
function makeEvaluate(
  scrapeBlob: unknown,
  opts: { href?: string; scroll?: () => unknown; place?: unknown } = {},
): BrowserPage["evaluate"] {
  const href =
    opts.href ??
    "https://www.google.com/maps/search/x/@45.582012,-73.582867,14z?hl=en";
  return (async (fn: unknown) => {
    const src = typeof fn === "string" ? fn : "";
    if (src.includes("location.href)()")) return href;
    if (src.includes("selectors.some(")) return true;
    if (src.includes("feed.scrollTo")) {
      return opts.scroll ? opts.scroll() : { count: 0, scrollable: false };
    }
    if (src.includes('data-item-id="authority"')) {
      return opts.place ?? { title: "", text: "", url: "", website: "" };
    }
    return scrapeBlob;
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
    queries: [
      {
        query: "gluten free restaurant Plateau-Mont-Royal, Montreal",
        subject: "gluten free restaurant",
      },
    ],
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
        (l) => l.level === "warn" && /found 6 card\(s\) but extracted 0 place\(s\)/.test(l.message),
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

describe("locationProbe — what we ask Google to resolve", () => {
  const loc = (over: Record<string, unknown>) =>
    LocationSchema.parse({ query: "Quebec, Canada", ...over });

  it("leads with the postal code, because that is the finest thing the user gave", () => {
    // OpenStreetMap cannot resolve a Canadian FSA at all, so this string is the
    // only path from "H1S" to a map point anywhere in the stack.
    expect(locationProbe(loc({ postalCode: "H1S", countryName: "Canada" }))).toBe(
      "H1S, Canada",
    );
  });

  it("drops the free-text query when a postal code is present", () => {
    // "Quebec, Canada" is exactly what sent job 8150b7c4 to Quebec City: leaving
    // it in front of the postal code lets Google anchor on the wrong one.
    const probe = locationProbe(
      loc({ postalCode: "H1S", region: "Quebec", countryName: "Canada" }),
    );
    expect(probe.startsWith("H1S")).toBe(true);
    expect(probe).not.toContain("Quebec, Canada,");
  });

  it("falls back to the text query when there is no postal code", () => {
    expect(
      locationProbe(
        LocationSchema.parse({ query: "Plateau-Mont-Royal", city: "Montreal" }),
      ),
    ).toBe("Plateau-Mont-Royal, Montreal");
  });

  it("does not repeat a part the query already names", () => {
    expect(
      locationProbe(
        LocationSchema.parse({ query: "Montreal, Quebec", city: "Montreal", region: "Quebec" }),
      ),
    ).toBe("Montreal, Quebec");
  });
});

describe("parseViewport", () => {
  it("reads the viewport Maps writes back into the address bar", () => {
    expect(
      parseViewport(
        "https://www.google.com/maps/place/Montr%C3%A9al,+QC+H1S/@45.5820124,-73.5828674,14z/data=!3m1",
      ),
    ).toEqual({ lat: 45.5820124, lng: -73.5828674, zoom: 14 });
  });

  it("is undefined for a URL Maps has not resolved yet", () => {
    expect(parseViewport("https://www.google.com/maps/search/x")).toBeUndefined();
  });

  it("rejects out-of-range coordinates rather than trusting the page", () => {
    expect(parseViewport("https://x/@95.0,-73.5,14z")).toBeUndefined();
    expect(parseViewport("https://x/@45.5,-999.0,14z")).toBeUndefined();
  });
});

describe("isSafeSiteUrl — the one URL that comes off a scraped page", () => {
  it("allows an ordinary business website", () => {
    expect(isSafeSiteUrl("https://www.panella.ca/")).toBe(true);
    expect(isSafeSiteUrl("http://example.com/menu")).toBe(true);
  });

  it("rejects a non-http scheme", () => {
    expect(isSafeSiteUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeSiteUrl("file:///etc/passwd")).toBe(false);
    expect(isSafeSiteUrl("data:text/html,x")).toBe(false);
  });

  it("rejects anything that could point inside an infrastructure network", () => {
    expect(isSafeSiteUrl("http://localhost:8080/")).toBe(false);
    expect(isSafeSiteUrl("http://127.0.0.1/")).toBe(false);
    expect(isSafeSiteUrl("http://169.254.169.254/latest/meta-data/")).toBe(false);
    expect(isSafeSiteUrl("http://10.0.0.5/")).toBe(false);
    expect(isSafeSiteUrl("http://metadata.internal/")).toBe(false);
    expect(isSafeSiteUrl("http://[::1]/")).toBe(false);
  });

  it("rejects garbage", () => {
    expect(isSafeSiteUrl("")).toBe(false);
    expect(isSafeSiteUrl("not a url")).toBe(false);
  });
});

/** Captures every URL the adapter navigates to, so a test can assert on the
 *  search it actually issued rather than on a log line. */
function makeRecordingSession(
  evaluate: BrowserPage["evaluate"],
): { session: BrowserSession; urls: string[] } {
  const urls: string[] = [];
  const page: BrowserPage = {
    goto: async (url: string) => {
      urls.push(url);
    },
    waitForTimeout: async () => undefined,
    evaluate,
    content: async () => "<html></html>",
    close: async () => undefined,
  };
  return {
    urls,
    session: {
      sessionId: "test-session",
      mode: "live",
      newPage: async () => page,
      close: async () => undefined,
      getReplayUrl: async () => undefined,
      downloadReplay: async () => undefined,
    },
  };
}

describe("googleMapsAdapter — stage 1, anchoring the search", () => {
  it("pins every search to the resolved viewport and drops the location text", async () => {
    // The regression this exists for: "Cuisine italienne restaurant Quebec,
    // Canada H1S" with no `@` segment resolved to `@46.18,-72.42,9z` and
    // returned Quebec City results for a Montreal postal code.
    const { session, urls } = makeRecordingSession(
      makeEvaluate(
        { results: [] },
        { href: "https://www.google.com/maps/place/x/@45.582012,-73.582867,14z" },
      ),
    );
    const ctx = makeCtx({ browser: session });

    await googleMapsAdapter.run(ctx);

    const search = urls.at(-1)!;
    expect(search).toContain("@45.582012,-73.582867,13z");
    // The subject, not the full query: no location phrase in the text.
    expect(decodeURIComponent(search)).toContain("gluten free restaurant");
    expect(decodeURIComponent(search)).not.toContain("Plateau-Mont-Royal");
  });

  it("derives the zoom from the user's radius, not from Google's own guess", async () => {
    const { session, urls } = makeRecordingSession(
      // Google answers 14z for an FSA; a 25 km radius must still search 25 km.
      makeEvaluate({ results: [] }, { href: "https://x/@45.582012,-73.582867,14z" }),
    );
    const ctx = makeCtx({
      browser: session,
      location: LocationSchema.parse({ query: "Montreal", radiusKm: 25 }),
    });

    await googleMapsAdapter.run(ctx);

    expect(urls.at(-1)).toContain(",11z");
  });

  it("skips the resolve hop when the job already carries coordinates", async () => {
    const { session, urls } = makeRecordingSession(makeEvaluate({ results: [] }));
    const ctx = makeCtx({
      browser: session,
      location: LocationSchema.parse({
        query: "Montreal",
        lat: 45.5031,
        lng: -73.5698,
      }),
    });

    await googleMapsAdapter.run(ctx);

    // One navigation only: the search itself. No page load spent re-resolving
    // what the form's forward geocode already settled.
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain("@45.503100,-73.569800,13z");
  });

  it("still resolves via Maps when a postal code is present, coordinates or not", async () => {
    // Coordinates from the text geocode describe the CITY; the postal code is
    // finer, and Google is the only geocoder here that can read one.
    const { session, urls } = makeRecordingSession(
      makeEvaluate({ results: [] }, { href: "https://x/@45.582012,-73.582867,14z" }),
    );
    const ctx = makeCtx({
      browser: session,
      location: LocationSchema.parse({
        query: "Montreal",
        postalCode: "H1S",
        lat: 45.5031,
        lng: -73.5698,
      }),
    });

    await googleMapsAdapter.run(ctx);

    expect(urls).toHaveLength(2);
    expect(decodeURIComponent(urls[0]!)).toContain("H1S");
    expect(urls[1]).toContain("@45.582012,-73.582867,13z");
  });

  it("falls back to the location-carrying query text when no viewport resolves", async () => {
    const { session, urls } = makeRecordingSession(
      makeEvaluate({ results: [] }, { href: "https://www.google.com/maps/search/x" }),
    );
    const ctx = makeCtx({ browser: session });

    await googleMapsAdapter.run(ctx);

    const search = decodeURIComponent(urls.at(-1)!);
    expect(search).not.toContain("@");
    expect(search).toContain("Plateau-Mont-Royal, Montreal");
  });
});

describe("googleMapsAdapter — stage 2, feed depth", () => {
  it("scrolls until the feed stops growing and reports how far it got", async () => {
    // 7 without scrolling, 22 with: the expected top result was at index 15.
    const counts = [7, 15, 22, 22];
    let call = 0;
    const { lines, log } = recorder();
    const ctx = makeCtx({
      log,
      browser: makeLiveSession(
        makeEvaluate(
          { results: [], rawCount: 22 },
          { scroll: () => ({ count: counts[Math.min(call++, counts.length - 1)], scrollable: true }) },
        ),
      ),
    });

    await googleMapsAdapter.run(ctx);

    expect(call).toBeGreaterThan(2);
    expect(
      lines.some((l) => /after 22 scrolled/.test(l.message)),
    ).toBe(true);
  });

  it("stops immediately when there is no scrollable feed", async () => {
    let call = 0;
    const ctx = makeCtx({
      browser: makeLiveSession(
        makeEvaluate(
          { results: [] },
          {
            scroll: () => {
              call++;
              return { count: 3, scrollable: false };
            },
          },
        ),
      ),
    });

    await googleMapsAdapter.run(ctx);

    expect(call).toBe(1);
  });
});

const CELIAC: PlannedRequirement = {
  id: "celiac",
  catalogId: "celiac",
  label: "Celiac",
  intentIds: ["dining"],
  must: ["dedicated gluten-free kitchen"],
  nice: [],
  weight: 3,
  satisfiedBy: ["the venue is entirely gluten-free"],
};

/** A results page that lists one place, and a fake LLM that extracts it with a
 *  polarity the test chooses — `unclear` is what a 600-char card realistically
 *  yields for "dedicated gluten-free kitchen". */
function enrichmentCtx(
  polarity: "unclear" | "supports",
  over: Partial<AdapterContext> = {},
  /** What the DETAIL page yields. Left `unclear` by default so the website hop
   *  still has a reason to fire. */
  detailPolarity: "unclear" | "supports" = "unclear",
): { ctx: AdapterContext; urls: string[]; lines: { message: string }[] } {
  const { lines, log } = recorder();
  const llm = new FakeLlmProvider({
    // The results-page blob is `{ results: [...] }`; an enrichment blob is
    // `{ place: {...} }`. That is the seam between "what the card said" and
    // "what the place's own page said".
    handler: (args) => {
      const isDetail = args.user.includes('\"place\"');
      return {
        places: [
          {
            name: "Cantine Panella",
            address: "515 Rue Saint-Zotique Est",
            evidence: [
              isDetail
                ? {
                    requirementId: "celiac",
                    claim: "review topic names it",
                    polarity: detailPolarity,
                    quote: "",
                    confidence: 0.9,
                  }
                : {
                    requirementId: "celiac",
                    claim: "card says nothing",
                    polarity,
                    quote: "",
                    confidence: 0.5,
                  },
            ],
          },
        ],
      };
    },
  });
  const { session, urls } = makeRecordingSession(
    makeEvaluate(
      {
        results: [
          {
            name: "Cantine Panella",
            url: "https://www.google.com/maps/place/Cantine+Panella/data=x",
            snippet: "Boulangerie",
          },
        ],
      },
      {
        href: "https://x/@45.582012,-73.582867,14z",
        place: {
          title: "Cantine Panella",
          address: "515 Rue Saint-Zotique Est",
          website: "https://panella.ca/",
          reviewTopics: ["sans gluten, mentionné dans 89 avis"],
          text: "Boulangerie sans gluten",
          url: "https://www.google.com/maps/place/Cantine+Panella",
        },
      },
    ),
  );
  return {
    urls,
    lines,
    ctx: makeCtx({ log, llm, browser: session, requirements: [CELIAC], ...over }),
  };
}

describe("googleMapsAdapter — stage 3, enriching what the card could not settle", () => {
  it("opens the place page when a requirement is left unverified", async () => {
    // The complaint this fixes: every place came back "unclear" on celiac
    // because a result card cannot describe a kitchen.
    const { ctx, urls, lines } = enrichmentCtx("unclear");

    await googleMapsAdapter.run(ctx);

    expect(urls).toContain("https://www.google.com/maps/place/Cantine+Panella/data=x");
    expect(lines.some((l) => /opening Cantine Panella for: Celiac/.test(l.message))).toBe(
      true,
    );
  });

  it("does not spend a page load when the results page already settled it", async () => {
    const { ctx, urls } = enrichmentCtx("supports");

    await googleMapsAdapter.run(ctx);

    expect(urls).not.toContain("https://www.google.com/maps/place/Cantine+Panella/data=x");
  });

  it("does nothing at all when the run has no requirements", async () => {
    const { ctx, urls } = enrichmentCtx("unclear", { requirements: [] });

    await googleMapsAdapter.run(ctx);

    expect(urls.some((u) => u.includes("/maps/place/"))).toBe(false);
  });

  it("folds the extra evidence into the existing place, never a second one", async () => {
    // A detail page reports a fuller address than the card; emitting it as a new
    // finding would split one restaurant into two through `canonicalKey`.
    const { ctx } = enrichmentCtx("unclear", {}, "supports");

    const result = await googleMapsAdapter.run(ctx);

    expect(result.findings).toHaveLength(1);
    const evidence = result.findings[0]!.evidence;
    expect(evidence).toHaveLength(2);
    // The card left it open; the detail page settled it. That flip is the
    // entire point of the stage.
    expect(evidence.map((e) => e.polarity)).toEqual(["unclear", "supports"]);
  });

  it("stops after the detail page when that settles the question", async () => {
    const { ctx, urls } = enrichmentCtx("unclear", {}, "supports");

    await googleMapsAdapter.run(ctx);

    expect(urls).not.toContain("https://panella.ca/");
  });

  it("drops duplicate evidence rather than counting the same claim twice", async () => {
    // Detail page repeats verbatim what the card already said.
    const { ctx } = enrichmentCtx("unclear", {}, "unclear");

    const result = await googleMapsAdapter.run(ctx);

    const celiac = result.findings[0]!.evidence.filter(
      (e) => e.requirementId === "celiac" && e.polarity === "unclear",
    );
    expect(new Set(celiac.map((e) => e.claim)).size).toBe(celiac.length);
  });

  it("falls through to the website when the detail page still leaves it open", async () => {
    const { ctx, urls } = enrichmentCtx("unclear");

    await googleMapsAdapter.run(ctx);

    expect(urls).toContain("https://panella.ca/");
  });

  it("refuses a website URL that points inside an infrastructure network", async () => {
    const { lines, log } = recorder();
    const llm = new FakeLlmProvider({
      handler: () => ({
        places: [
          {
            name: "Cantine Panella",
            evidence: [
              { requirementId: "celiac", claim: "c", polarity: "unclear", quote: "", confidence: 0.5 },
            ],
          },
        ],
      }),
    });
    const { session, urls } = makeRecordingSession(
      makeEvaluate(
        {
          results: [
            { name: "Cantine Panella", url: "https://www.google.com/maps/place/x", snippet: "" },
          ],
        },
        {
          href: "https://x/@45.58,-73.58,14z",
          place: {
            title: "Cantine Panella",
            // Third-party input: the one URL in this adapter that does not come
            // from our own constants.
            website: "http://169.254.169.254/latest/meta-data/",
            reviewTopics: [],
            text: "x",
            url: "https://www.google.com/maps/place/x",
          },
        },
      ),
    );
    const ctx = makeCtx({ log, llm, browser: session, requirements: [CELIAC] });

    await googleMapsAdapter.run(ctx);

    expect(urls.some((u) => u.includes("169.254.169.254"))).toBe(false);
    expect(lines.length).toBeGreaterThan(0);
  });
});

describe("page-side strings added for stages 1-3 — same real-eval guard", () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, "document");
    Reflect.deleteProperty(globalThis, "location");
  });

  /** A feed of `role="article"` cards: `withLink` of them look like places, the
   *  rest look like the filter-chip row (a feed child with no place anchor). */
  function installFeedDom(total: number, withLink: number): { scrolled: boolean } {
    const state = { scrolled: false };
    const makeCard = (hasLink: boolean) => {
      const anchor = {
        href: "https://www.google.com/maps/place/Test+Cafe/data=x",
        getAttribute: (a: string) => (a === "aria-label" ? "Test Cafe" : null),
      };
      return {
        getAttribute: (a: string) =>
          a === "aria-label" ? (hasLink ? "Test Cafe" : "Filters available") : null,
        querySelector: (sel: string) =>
          hasLink && sel.includes("/maps/place/") ? anchor : null,
        querySelectorAll: () => [],
        matches: () => false,
        innerText: hasLink ? "Test Cafe | 4,5 | Italienne" : "PriceRatingHours",
      };
    };
    const cards = Array.from({ length: total }, (_, i) => makeCard(i < withLink));
    const feed = {
      scrollHeight: 5000,
      scrollTo: () => {
        state.scrolled = true;
      },
    };
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        title: "Google Maps",
        body: { innerText: "body text" },
        querySelector: (sel: string) => (sel === 'div[role="feed"]' ? feed : null),
        querySelectorAll: (sel: string) => (sel === '[role="article"]' ? cards : []),
      },
    });
    Object.defineProperty(globalThis, "location", {
      configurable: true,
      value: { href: "https://www.google.com/maps/search/x/@45.5,-73.5,13z" },
    });
    return state;
  }

  it("HREF_FN evaluates to the URL string, not a Function value", () => {
    installFeedDom(0, 0);
    // Intentional eval: this is exactly what real Page.evaluate(string) does.
    const result = eval(__pageFunctionsForTest.HREF_FN);
    expect(typeof result).toBe("string");
    expect(parseViewport(result as string)).toEqual({ lat: 45.5, lng: -73.5, zoom: 13 });
  });

  it("SCROLL_FEED_FN actually scrolls the feed and reports the count", () => {
    const state = installFeedDom(7, 7);
    // Intentional eval: this is exactly what real Page.evaluate(string) does.
    const result = eval(__pageFunctionsForTest.SCROLL_FEED_FN) as {
      count: number;
      scrollable: boolean;
    };
    expect(result).not.toBeInstanceOf(Function);
    expect(state.scrolled).toBe(true);
    expect(result).toEqual({ count: 7, scrollable: true });
  });

  it("SCROLL_FEED_FN reports `scrollable: false` when there is no feed", () => {
    installFeedDom(0, 0);
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: { title: "x", querySelector: () => null, querySelectorAll: () => [] },
    });
    // Intentional eval: this is exactly what real Page.evaluate(string) does.
    const result = eval(__pageFunctionsForTest.SCROLL_FEED_FN) as { scrollable: boolean };
    expect(result.scrollable).toBe(false);
  });

  it("SCRAPE_FN keeps place cards and drops the filter-chip row", () => {
    // 5 cards, 3 of which are real places. The other 2 are the chrome that used
    // to reach the LLM as a place called "Filters available for this search".
    installFeedDom(5, 3);
    // Intentional eval: this is exactly what real Page.evaluate(string) does.
    const result = eval(__pageFunctionsForTest.SCRAPE_FN) as {
      results: { name: string; url?: string }[];
      rawCount: number;
      chromeCount: number;
    };
    expect(result.rawCount).toBe(5);
    expect(result.results).toHaveLength(3);
    expect(result.chromeCount).toBe(2);
    expect(result.results.every((r) => r.name === "Test Cafe")).toBe(true);
    // The place link is what stage 3 reopens the place with.
    expect(result.results.every((r) => r.url?.includes("/maps/place/"))).toBe(true);
  });

  it("PLACE_FN evaluates to the detail object, not a Function value", () => {
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        title: "Cantine Panella",
        body: { innerText: "" },
        querySelector: (sel: string) => {
          if (sel === "h1") return { textContent: "Cantine Panella" };
          if (sel.includes("authority")) return { href: "https://panella.ca/" };
          if (sel.includes('role="main"')) return { innerText: "Boulangerie sans gluten" };
          return null;
        },
        querySelectorAll: () => [
          { getAttribute: () => "sans gluten, mentionné dans 89 avis" },
          { getAttribute: () => "Itinéraires" },
        ],
      },
    });
    Object.defineProperty(globalThis, "location", {
      configurable: true,
      value: { href: "https://www.google.com/maps/place/Cantine+Panella" },
    });
    // Intentional eval: this is exactly what real Page.evaluate(string) does.
    const result = eval(__pageFunctionsForTest.PLACE_FN) as {
      title: string;
      website: string;
      reviewTopics: string[];
      text: string;
    };
    expect(result).not.toBeInstanceOf(Function);
    expect(result.title).toBe("Cantine Panella");
    expect(result.website).toBe("https://panella.ca/");
    // The quantified review-topic chip: the strongest evidence a Maps page
    // carries, and invisible to `innerText` because it lives in an aria-label.
    expect(result.reviewTopics).toEqual(["sans gluten, mentionné dans 89 avis"]);
    expect(result.text).toContain("sans gluten");
  });

  it("SITE_FN evaluates to the page text, not a Function value", () => {
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        title: "Panella",
        body: { innerText: "Notre cuisine est entièrement sans gluten." },
        querySelector: () => null,
      },
    });
    Object.defineProperty(globalThis, "location", {
      configurable: true,
      value: { href: "https://panella.ca/" },
    });
    // Intentional eval: this is exactly what real Page.evaluate(string) does.
    const result = eval(__pageFunctionsForTest.SITE_FN) as { title: string; text: string };
    expect(result).not.toBeInstanceOf(Function);
    expect(result.title).toBe("Panella");
    expect(result.text).toContain("entièrement sans gluten");
  });
});

const ITALIAN: PlannedRequirement = {
  id: "custom_cuisine_italienne",
  label: "Cuisine italienne",
  intentIds: ["dining"],
  must: [],
  nice: [],
  weight: 1,
  satisfiedBy: [],
};

/** A results page returning `names`, and an LLM that echoes each one back with
 *  the evidence the test dictates. */
function manyResultsCtx(
  names: string[],
  evidenceFor: (name: string) => { requirementId: string; polarity: string; confidence: number }[],
  over: Partial<AdapterContext> = {},
): { ctx: AdapterContext; urls: string[]; lines: { message: string }[] } {
  const { lines, log } = recorder();
  const llm = new FakeLlmProvider({
    handler: (args) => {
      const listed = names.filter((n) => args.user.includes(n));
      return {
        places: listed.map((name) => ({
          name,
          address: `${names.indexOf(name) + 1} Rue Test`,
          evidence: evidenceFor(name).map((e) => ({ ...e, claim: "c", quote: "" })),
        })),
      };
    },
  });
  const { session, urls } = makeRecordingSession(
    makeEvaluate(
      {
        results: names.map((name) => ({
          name,
          url: `https://www.google.com/maps/place/${encodeURIComponent(name)}`,
          snippet: name,
        })),
      },
      { href: "https://x/@45.582012,-73.582867,14z" },
    ),
  );
  return { urls, lines, ctx: makeCtx({ log, llm, browser: session, ...over }) };
}

describe("googleMapsAdapter — every planned query actually runs", () => {
  it("issues the second query even when the first already filled the limit", async () => {
    // The regression: one query now returns ~30 places, so a
    // `findings.length >= limit` break tripped on the FIRST query every time
    // and the user's actual subject was never searched for.
    const { ctx, urls } = manyResultsCtx(
      ["A", "B", "C"],
      () => [{ requirementId: "celiac", polarity: "supports", confidence: 0.9 }],
      {
        limit: 2,
        queries: [
          { query: "sans gluten restaurant MTL", subject: "sans gluten restaurant" },
          { query: "Cuisine italienne restaurant MTL", subject: "Cuisine italienne restaurant" },
        ],
      },
    );

    await googleMapsAdapter.run(ctx);

    // The resolve hop is a /maps/search/ URL too; only the anchored ones carry `@`.
    const searches = urls.filter((u) => u.includes("/maps/search/") && u.includes("/@"));
    expect(searches).toHaveLength(2);
    expect(decodeURIComponent(searches[1]!)).toContain("Cuisine italienne");
  });
});

describe("googleMapsAdapter — ranking before the cap", () => {
  it("keeps the best-scoring places, not the first ones the page rendered", async () => {
    // "Wanted" is rendered LAST and would have been sliced away by the old
    // `findings.slice(0, limit)`.
    const { ctx } = manyResultsCtx(
      ["Filler1", "Filler2", "Wanted"],
      (name) =>
        name === "Wanted"
          ? [{ requirementId: "celiac", polarity: "supports", confidence: 0.9 }]
          : [{ requirementId: "celiac", polarity: "unclear", confidence: 0.5 }],
      { limit: 1, requirements: [CELIAC] },
    );

    const result = await googleMapsAdapter.run(ctx);

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.place.name).toBe("Wanted");
  });

  it("breaks a score tie by review count", async () => {
    const { lines, log } = recorder();
    const llm = new FakeLlmProvider({
      handler: () => ({
        places: [
          { name: "Quiet", address: "1 Rue Test", reviewCount: 3, evidence: [] },
          { name: "Busy", address: "2 Rue Test", reviewCount: 1694, evidence: [] },
        ],
      }),
    });
    const { session } = makeRecordingSession(
      makeEvaluate(
        {
          results: [
            { name: "Quiet", url: "https://www.google.com/maps/place/q", snippet: "" },
            { name: "Busy", url: "https://www.google.com/maps/place/b", snippet: "" },
          ],
        },
        { href: "https://x/@45.58,-73.58,14z" },
      ),
    );
    const ctx = makeCtx({ log, llm, browser: session, limit: 1, requirements: [CELIAC] });

    const result = await googleMapsAdapter.run(ctx);

    expect(result.findings[0]!.place.name).toBe("Busy");
    expect(lines.some((l) => /keeping the 1 best-scoring of 2/.test(l.message))).toBe(true);
  });

  it("collapses a place that matched both queries into one entry", async () => {
    const { ctx, lines } = manyResultsCtx(
      ["Ottavio"],
      () => [{ requirementId: "celiac", polarity: "unclear", confidence: 0.5 }],
      {
        limit: 8,
        requirements: [CELIAC],
        queries: [
          { query: "sans gluten restaurant MTL", subject: "sans gluten restaurant" },
          { query: "Cuisine italienne restaurant MTL", subject: "Cuisine italienne restaurant" },
        ],
      },
    );

    const result = await googleMapsAdapter.run(ctx);

    expect(result.findings).toHaveLength(1);
    expect(lines.some((l) => /2 result\(s\) across 2 queries → 1 distinct place/.test(l.message))).toBe(
      true,
    );
  });
});

describe("googleMapsAdapter — enrichment researches restrictions, not the subject", () => {
  it("never opens a page to re-check the free-text subject", async () => {
    // "Italian" is what Google matched on; a place in the results is Italian by
    // construction. A real run burned 5 of 6 page loads looking for "Cuisine
    // italienne" on the websites of gluten-free bakeries.
    const { ctx, urls } = manyResultsCtx(
      ["Gluten Free Bakery"],
      () => [
        { requirementId: "celiac", polarity: "supports", confidence: 0.9 },
        { requirementId: "custom_cuisine_italienne", polarity: "unclear", confidence: 0.5 },
      ],
      { requirements: [CELIAC, ITALIAN] },
    );

    await googleMapsAdapter.run(ctx);

    expect(urls.some((u) => u.includes("/maps/place/"))).toBe(false);
  });

  it("still opens a page when a catalog restriction is unresolved", async () => {
    const { ctx, urls, lines } = manyResultsCtx(
      ["Ottavio"],
      () => [
        { requirementId: "custom_cuisine_italienne", polarity: "supports", confidence: 0.9 },
        { requirementId: "celiac", polarity: "unclear", confidence: 0.5 },
      ],
      { requirements: [CELIAC, ITALIAN] },
    );

    await googleMapsAdapter.run(ctx);

    expect(urls.some((u) => u.includes("/maps/place/"))).toBe(true);
    // Only the restriction is named as the reason.
    expect(lines.some((l) => /opening Ottavio for: Celiac$/.test(l.message))).toBe(true);
  });

  it("does nothing when the run has only ad-hoc requirements", async () => {
    const { ctx, urls } = manyResultsCtx(
      ["Somewhere"],
      () => [{ requirementId: "custom_cuisine_italienne", polarity: "unclear", confidence: 0.5 }],
      { requirements: [ITALIAN] },
    );

    await googleMapsAdapter.run(ctx);

    expect(urls.some((u) => u.includes("/maps/place/"))).toBe(false);
  });
});

describe("googleMapsAdapter — progress reporting", () => {
  it("reports monotonically increasing progress and ends at 1", async () => {
    const seen: AdapterProgress[] = [];
    const { ctx } = manyResultsCtx(
      ["A", "B"],
      () => [{ requirementId: "celiac", polarity: "unclear", confidence: 0.5 }],
      {
        requirements: [CELIAC],
        reportProgress: (u) => seen.push(u),
        queries: [
          { query: "q1 MTL", subject: "q1" },
          { query: "q2 MTL", subject: "q2" },
        ],
      },
    );

    await googleMapsAdapter.run(ctx);

    expect(seen.length).toBeGreaterThan(4);
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]!.fraction).toBeGreaterThanOrEqual(seen[i - 1]!.fraction);
    }
    expect(seen.at(-1)!.fraction).toBe(1);
  });

  it("names searches first, then the places those searches turned up", async () => {
    // The unit changes partway through the phase. That is exactly why the bar
    // reads `fraction` and only the LABEL reads done/total.
    const seen: AdapterProgress[] = [];
    const { ctx } = manyResultsCtx(
      ["Ottavio"],
      () => [{ requirementId: "celiac", polarity: "unclear", confidence: 0.5 }],
      { requirements: [CELIAC], reportProgress: (u) => seen.push(u) },
    );

    await googleMapsAdapter.run(ctx);

    const units = seen.map((u) => u.unit).filter(Boolean);
    expect(units[0]).toBe("query");
    expect(units).toContain("place");
    // ...and the place total is the enrichment queue, discovered only after the
    // searches have run.
    const place = seen.find((u) => u.unit === "place");
    expect(place?.total).toBe(1);
  });

  it("spends the enrichment share even when nothing needs enriching", async () => {
    // Otherwise the bar strands at ~50% of the adapter for every run whose
    // results page settled everything.
    const seen: AdapterProgress[] = [];
    const { ctx } = manyResultsCtx(
      ["Verified"],
      () => [{ requirementId: "celiac", polarity: "supports", confidence: 0.9 }],
      { requirements: [CELIAC], reportProgress: (u) => seen.push(u) },
    );

    await googleMapsAdapter.run(ctx);

    expect(seen.at(-1)!.fraction).toBe(1);
    expect(seen.some((u) => u.fraction > 0.9)).toBe(true);
  });

  it("advances past a place whose enrichment threw", async () => {
    const seen: AdapterProgress[] = [];
    const { lines, log } = recorder();
    const llm = new FakeLlmProvider({
      handler: () => ({
        places: [
          {
            name: "Broken",
            address: "1 Rue Test",
            evidence: [
              { requirementId: "celiac", claim: "c", polarity: "unclear", quote: "", confidence: 0.5 },
            ],
          },
        ],
      }),
    });
    let navigations = 0;
    const page: BrowserPage = {
      goto: async () => {
        navigations += 1;
        // Fail the enrichment load: resolve hop and search must still work.
        if (navigations > 2) throw new Error("navigation failed");
      },
      waitForTimeout: async () => undefined,
      evaluate: makeEvaluate(
        {
          results: [
            { name: "Broken", url: "https://www.google.com/maps/place/b", snippet: "" },
          ],
        },
        { href: "https://x/@45.58,-73.58,14z" },
      ),
      content: async () => "<html></html>",
      close: async () => undefined,
    };
    const ctx = makeCtx({
      log,
      llm,
      requirements: [CELIAC],
      reportProgress: (u) => seen.push(u),
      browser: {
        sessionId: "s",
        mode: "live",
        newPage: async () => page,
        close: async () => undefined,
        getReplayUrl: async () => undefined,
        downloadReplay: async () => undefined,
      },
    });

    await googleMapsAdapter.run(ctx);

    expect(seen.at(-1)!.fraction).toBe(1);
    expect(lines.some((l) => /enrichment failed/.test(l.message))).toBe(true);
  });
});
