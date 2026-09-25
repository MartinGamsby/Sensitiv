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
  cutByDistance,
  extractionBatchCount,
  googleMapsAdapter,
  locationProbe,
  mapsPlaceUrl,
  mergeCards,
  parsePlaceCoords,
  parseViewport,
  safeThumbnailUrl,
} from "./google-maps.ts";
import { isSafeSiteUrl } from "../util.ts";
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
  opts: {
    href?: string;
    scroll?: () => unknown;
    /** What the card-count probe reads while a scroll's lazy load lands. */
    count?: () => unknown;
    place?: unknown;
    /** What the official-website hop reads back. */
    site?: unknown;
  } = {},
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
    // COUNT_FN — the only page function that names its selector list `tiers`.
    if (src.includes("const tiers")) return opts.count ? opts.count() : 0;
    if (src.includes('data-item-id="authority"')) {
      return opts.place ?? { title: "", text: "", url: "", website: "" };
    }
    // SITE_FN — the only page function that reads social-card metadata.
    if (src.includes("og:image")) {
      return opts.site ?? { title: "", url: "", image: "", text: "" };
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
    recording: false,
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
    // This adapter never calls it; a fetch that throws is what proves that.
    fetch: () => Promise.reject(new Error("no network in tests")),
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

    await expect(googleMapsAdapter.run(ctx)).resolves.toMatchObject({ findings: [] });

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

    await expect(googleMapsAdapter.run(ctx)).resolves.toMatchObject({ findings: [] });

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
      recording: false,
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

  it("spends no page load re-resolving a PINNED location, postal code or not", async () => {
    // The map pin inverts the rule above. Geocoded coordinates lose to a postal
    // code because they are coarser than one; a pin is finer than one — the
    // user pointed at a spot, not at a delivery area — so re-resolving through
    // Google could only make the anchor worse, and costs a page load to do it.
    const { session, urls } = makeRecordingSession(makeEvaluate({ results: [] }));
    const ctx = makeCtx({
      browser: session,
      location: LocationSchema.parse({
        query: "Ville-Marie, Montreal",
        postalCode: "H2T",
        lat: 45.4914,
        lng: -73.5832,
        pinned: true,
        radiusKm: 5,
      }),
    });

    await googleMapsAdapter.run(ctx);

    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain("@45.491400,-73.583200,13z");
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

  it("does not scroll at all on a quick search, and says so", async () => {
    // The distinguishing case: the feed here WOULD keep growing (7 → 22) if
    // anything asked it to, so a green result means the scroll was skipped
    // rather than that there was nothing to scroll. The deep test above runs
    // the same feed and does reach 22.
    const counts = [7, 15, 22, 22];
    let call = 0;
    const { lines, log } = recorder();
    const ctx = makeCtx({
      log,
      quickSearch: true,
      browser: makeLiveSession(
        makeEvaluate(
          { results: [], rawCount: 7 },
          { scroll: () => ({ count: counts[Math.min(call++, counts.length - 1)], scrollable: true }) },
        ),
      ),
    });

    await googleMapsAdapter.run(ctx);

    expect(call).toBe(0);
    expect(lines.some((l) => /on the first screen \(not scrolled\)/.test(l.message))).toBe(true);
    expect(lines.some((l) => l.level === "info" && /^quick search —/.test(l.message))).toBe(true);
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
  /** A hero photo on the detail page. Absent by default, which is now itself
   *  a reason for the website hop to fire — `og:image` is the photo fallback
   *  for a place Maps has no carousel for. */
  detailThumbnail = "",
  /** The official website's text. Empty by default, which ends the website
   *  hop before any extraction whatever else is going on. */
  siteText = "",
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
          thumbnailUrl: detailThumbnail,
          reviewTopics: ["sans gluten, mentionné dans 89 avis"],
          text: "Boulangerie sans gluten",
          url: "https://www.google.com/maps/place/Cantine+Panella",
        },
        site: {
          title: "Panella",
          url: "https://panella.ca/",
          image: "https://panella.ca/og.jpg",
          text: siteText,
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

  it("stops after the detail page when that settles the question and found a photo", async () => {
    const { ctx, urls } = enrichmentCtx(
      "unclear",
      {},
      "supports",
      "https://lh3.googleusercontent.com/p/hero=w80-h106-k-no",
    );

    await googleMapsAdapter.run(ctx);

    expect(urls).not.toContain("https://panella.ca/");
  });

  it("takes the website hop for a photo alone, once the question is settled", async () => {
    // The Panella case: every requirement answered, no picture anywhere on
    // Maps, and a card with no picture is the one a reader scrolls past. The
    // site's own `og:image` is there precisely when Google's carousel is not.
    const { ctx, urls } = enrichmentCtx("unclear", {}, "supports");

    const result = await googleMapsAdapter.run(ctx);

    expect(urls).toContain("https://panella.ca/");
    expect(result.findings[0]!.place.thumbnailUrl).toBe(
      "https://panella.ca/og.jpg",
    );
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

  it("COUNT_FN evaluates to the card count, not a Function value", () => {
    installFeedDom(5, 3);
    // Intentional eval: this is exactly what real Page.evaluate(string) does.
    const result = eval(__pageFunctionsForTest.COUNT_FN);
    expect(result).toBe(5);
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
        recording: false,
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

describe("safeThumbnailUrl — a scraped URL the SERVER will later fetch", () => {
  const real =
    "https://lh3.googleusercontent.com/gps-cs-s/AHRPTWmLbRk36wU9=w80-h106-k-no";

  it("accepts a Google user-content photo and upgrades its size suffix", () => {
    // Google sizes the URL for the slot it rendered in, and a result card's
    // slot is 80x106 — too small to look at.
    expect(safeThumbnailUrl(real)).toBe(
      "https://lh3.googleusercontent.com/gps-cs-s/AHRPTWmLbRk36wU9=w400-h300-k-no",
    );
  });

  it("leaves a URL with no size suffix alone", () => {
    const plain = "https://lh3.googleusercontent.com/abc";
    expect(safeThumbnailUrl(plain)).toBe(plain);
  });

  it("keeps a photo from any other public host, unresized", () => {
    // This used to be `*.googleusercontent.com` or nothing, and that
    // narrowness was the bug: a place Maps had no carousel for showed no
    // picture at all, however good a photo its own site served. The URL no
    // longer becomes an `<img src>` the reader's browser resolves — the
    // photo route fetches it server-side and re-validates — so the host set
    // can widen without widening what the page is allowed to load.
    expect(safeThumbnailUrl("https://panella.ca/og.jpg")).toBe(
      "https://panella.ca/og.jpg",
    );
    // No Google size suffix to rewrite, so nothing is rewritten.
    expect(safeThumbnailUrl("https://x.example/p=w80-h106-k-no")).toBe(
      "https://x.example/p=w80-h106-k-no",
    );
  });

  it("rejects a non-https scheme", () => {
    expect(safeThumbnailUrl("http://lh3.googleusercontent.com/x")).toBeUndefined();
    expect(safeThumbnailUrl("http://panella.ca/og.jpg")).toBeUndefined();
    expect(safeThumbnailUrl("javascript:alert(1)")).toBeUndefined();
    expect(safeThumbnailUrl("data:image/png;base64,AAAA")).toBeUndefined();
  });

  it("rejects anything that points inside an infrastructure network", () => {
    // Same rule as the website hop: our own server will fetch this later, so
    // "load whatever the page says" must not reach a loopback or metadata
    // address. See `memory/security-invariants.md`.
    expect(safeThumbnailUrl("https://localhost/p.png")).toBeUndefined();
    expect(safeThumbnailUrl("https://169.254.169.254/latest")).toBeUndefined();
    expect(safeThumbnailUrl("https://127.0.0.1/p.png")).toBeUndefined();
    expect(safeThumbnailUrl("https://redis.internal/p.png")).toBeUndefined();
    expect(safeThumbnailUrl("https://[::1]/p.png")).toBeUndefined();
    // Credentials in a photo URL are never a photo URL.
    expect(safeThumbnailUrl("https://u:p@panella.ca/og.jpg")).toBeUndefined();
  });

  it("rejects nothing and garbage", () => {
    expect(safeThumbnailUrl(undefined)).toBeUndefined();
    expect(safeThumbnailUrl("")).toBeUndefined();
    expect(safeThumbnailUrl("not a url")).toBeUndefined();
  });
});

describe("googleMapsAdapter — thumbnails", () => {
  it("attaches the card photo without ever routing it through the LLM", async () => {
    // A URL is exactly what a model will invent, and an invented one would be
    // persisted and rendered. The photo is read off the DOM and matched by
    // name after extraction, so every stored URL is one the page served.
    const { lines, log } = recorder();
    const llm = new FakeLlmProvider({
      handler: () => ({
        places: [{ name: "Ottavio", address: "6880 Rue Jean-Talon E", evidence: [] }],
      }),
    });
    const { session } = makeRecordingSession(
      makeEvaluate(
        {
          results: [
            {
              name: "Ottavio",
              url: "https://www.google.com/maps/place/Ottavio",
              thumbnailUrl: "https://lh3.googleusercontent.com/gps-cs-s/XYZ=w80-h106-k-no",
              snippet: "Italienne",
            },
          ],
        },
        { href: "https://x/@45.58,-73.58,14z" },
      ),
    );
    const ctx = makeCtx({ log, llm, browser: session });

    const result = await googleMapsAdapter.run(ctx);

    expect(result.findings[0]!.place.thumbnailUrl).toBe(
      "https://lh3.googleusercontent.com/gps-cs-s/XYZ=w400-h300-k-no",
    );
    // The blob handed to the LLM never carried it (see `extractionCard`).
    expect(llm.calls.every((c) => !c.user.includes("googleusercontent"))).toBe(true);
    expect(lines.length).toBeGreaterThan(0);
  });

  it("drops a card photo aimed inside an infrastructure network", async () => {
    const llm = new FakeLlmProvider({
      handler: () => ({ places: [{ name: "Ottavio", address: "1 Rue Test", evidence: [] }] }),
    });
    const { session } = makeRecordingSession(
      makeEvaluate(
        {
          results: [
            {
              name: "Ottavio",
              url: "https://www.google.com/maps/place/Ottavio",
              thumbnailUrl: "https://169.254.169.254/latest/meta-data/",
              snippet: "",
            },
          ],
        },
        { href: "https://x/@45.58,-73.58,14z" },
      ),
    );

    const result = await googleMapsAdapter.run(makeCtx({ llm, browser: session }));

    expect(result.findings[0]!.place.thumbnailUrl).toBeUndefined();
  });

  it("records no photo at all when no source offered one", async () => {
    // No photo anywhere still means no photo — never a broken image, and
    // never an invented URL.
    const { ctx } = enrichmentCtx("unclear", {}, "unclear");
    const { session } = makeRecordingSession(
      makeEvaluate(
        {
          results: [
            { name: "Cantine Panella", url: "https://www.google.com/maps/place/x", snippet: "" },
          ],
        },
        {
          href: "https://x/@45.58,-73.58,14z",
          place: { title: "Cantine Panella", text: "t", url: "https://maps/x", website: "" },
          site: { title: "", url: "", image: "", text: "" },
        },
      ),
    );

    const result = await googleMapsAdapter.run({ ...ctx, browser: session });

    expect(result.findings[0]!.place.thumbnailUrl).toBeUndefined();
  });
});

describe("page-side photo picking — real eval, the guard that caught the last bug", () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, "document");
    Reflect.deleteProperty(globalThis, "location");
  });

  function installCardWithImages(
    images: { src: string; w: number; h: number }[],
  ): void {
    const anchor = {
      href: "https://www.google.com/maps/place/Test/data=x",
      getAttribute: (a: string) => (a === "aria-label" ? "Test Cafe" : null),
    };
    const card = {
      getAttribute: (a: string) => (a === "aria-label" ? "Test Cafe" : null),
      querySelector: (sel: string) => (sel.includes("/maps/place/") ? anchor : null),
      querySelectorAll: (sel: string) =>
        sel === "img"
          ? images.map((i) => ({ src: i.src, naturalWidth: i.w, naturalHeight: i.h }))
          : [],
      matches: () => false,
      innerText: "Test Cafe",
    };
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        title: "Google Maps",
        body: { innerText: "" },
        querySelector: () => null,
        querySelectorAll: (sel: string) => (sel === '[role="article"]' ? [card] : []),
      },
    });
    Object.defineProperty(globalThis, "location", {
      configurable: true,
      value: { href: "https://www.google.com/maps/search/x" },
    });
  }

  it("takes the largest Google photo and ignores the gstatic avatar", () => {
    // Every Maps card carries a 40x40 reviewer-avatar placeholder on a
    // DIFFERENT host, which is why this filters by host and takes the biggest
    // rather than simply the first image on the card.
    installCardWithImages([
      { src: "https://ssl.gstatic.com/local/servicebusiness/default_user.png", w: 40, h: 40 },
      { src: "https://lh3.googleusercontent.com/small=w40-h40-k-no", w: 40, h: 40 },
      { src: "https://lh3.googleusercontent.com/big=w80-h106-k-no", w: 80, h: 106 },
    ]);
    // Intentional eval: this is exactly what real Page.evaluate(string) does.
    const result = eval(__pageFunctionsForTest.SCRAPE_FN) as {
      results: { thumbnailUrl?: string }[];
    };
    expect(result.results[0]!.thumbnailUrl).toBe(
      "https://lh3.googleusercontent.com/big=w80-h106-k-no",
    );
  });

  it("reports an empty photo when the card has none", () => {
    installCardWithImages([
      { src: "https://ssl.gstatic.com/local/servicebusiness/default_user.png", w: 40, h: 40 },
    ]);
    // Intentional eval: this is exactly what real Page.evaluate(string) does.
    const result = eval(__pageFunctionsForTest.SCRAPE_FN) as {
      results: { thumbnailUrl?: string }[];
    };
    expect(result.results[0]!.thumbnailUrl).toBe("");
  });

  it("is not fooled by a lookalike host", () => {
    installCardWithImages([
      { src: "https://googleusercontent.com.evil.example/x", w: 400, h: 400 },
    ]);
    // Intentional eval: this is exactly what real Page.evaluate(string) does.
    const result = eval(__pageFunctionsForTest.SCRAPE_FN) as {
      results: { thumbnailUrl?: string }[];
    };
    // The page-side filter is only a cheap first pass; `safeThumbnailUrl` is
    // the gate that matters, and it rejects this too.
    expect(safeThumbnailUrl(result.results[0]!.thumbnailUrl)).toBeUndefined();
  });
});

describe("parsePlaceCoords — coordinates out of a Maps place URL", () => {
  it("reads the !3d/!4d pair Maps encodes in the data blob", () => {
    // Deterministic rather than left to the extractor: the model was recovering
    // these only because the URL happened to be in the blob, and asking it to
    // copy eleven significant figures is a coin flip we do not need to take —
    // these now feed the score's proximity term, so a wrong digit moves rank.
    expect(
      parsePlaceCoords(
        "https://www.google.com/maps/place/Ottavio/data=!4m7!3m6!1s0x4cc9:0x1b0b!8m2!3d45.5956987!4d-73.5708881!16s%2Fg%2F11v",
      ),
    ).toEqual({ lat: 45.5956987, lng: -73.5708881 });
  });

  it("is undefined when the URL carries no coordinates", () => {
    expect(parsePlaceCoords("https://www.google.com/maps/place/Ottavio")).toBeUndefined();
    expect(parsePlaceCoords(undefined)).toBeUndefined();
    expect(parsePlaceCoords("not a url")).toBeUndefined();
  });

  it("rejects out-of-range values rather than trusting the page", () => {
    expect(parsePlaceCoords("x!3d95.0!4d-73.5")).toBeUndefined();
    expect(parsePlaceCoords("x!3d45.5!4d-999.0")).toBeUndefined();
  });

  it("reports the resolved centre so scoring can measure distance from it", async () => {
    // The runner cannot derive this: a job with a postal code deliberately
    // carries no coordinates, so the adapter is the only thing that knows.
    const { session } = makeRecordingSession(
      makeEvaluate({ results: [] }, { href: "https://x/@45.582012,-73.582867,14z" }),
    );

    const result = await googleMapsAdapter.run(makeCtx({ browser: session }));

    expect(result.center).toMatchObject({ lat: 45.582012, lng: -73.582867 });
  });
});

describe("googleMapsAdapter — parallelism (extraction was ~90% of a real run)", () => {
  it("splits a large result set into batches and runs them concurrently", async () => {
    // One query's 32 places went to the LLM as a single 134.5s call, out of a
    // 400s run. Smaller prompts also return more reliable per-place evidence.
    let inFlight = 0;
    let peak = 0;
    const names = Array.from({ length: 20 }, (_, i) => `Place ${i}`);
    const llm = new FakeLlmProvider({
      handler: (args) => {
        const listed = names.filter((n) => args.user.includes(`"${n}"`));
        return { places: listed.map((name) => ({ name, address: "1 Rue Test", evidence: [] })) };
      },
    });
    // Count concurrent calls by wrapping the provider.
    const counting = {
      name: llm.name,
      calls: llm.calls,
      completeStructured: async (args: Parameters<typeof llm.completeStructured>[0]) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 10));
        try {
          return await llm.completeStructured(args);
        } finally {
          inFlight -= 1;
        }
      },
    } as unknown as FakeLlmProvider;

    const { session } = makeRecordingSession(
      makeEvaluate(
        {
          results: names.map((name) => ({
            name,
            url: `https://www.google.com/maps/place/${encodeURIComponent(name)}`,
            snippet: name,
          })),
        },
        { href: "https://x/@45.58,-73.58,14z" },
      ),
    );

    const { lines, log } = recorder();
    await googleMapsAdapter.run(makeCtx({ log, llm: counting, browser: session, limit: 20 }));

    // 20 places at a batch size of 8 is three batches.
    expect(llm.calls.length).toBeGreaterThanOrEqual(3);
    expect(peak).toBeGreaterThan(1);
    expect(lines.some((l) => /extracted in 3 batch\(es\)/.test(l.message))).toBe(true);
  });

  it("does not batch a result set that fits in one call", async () => {
    const llm = new FakeLlmProvider({
      handler: () => ({ places: [{ name: "Solo", address: "1 Rue Test", evidence: [] }] }),
    });
    const { session } = makeRecordingSession(
      makeEvaluate(
        { results: [{ name: "Solo", url: "https://www.google.com/maps/place/s", snippet: "" }] },
        { href: "https://x/@45.58,-73.58,14z" },
      ),
    );
    const { lines, log } = recorder();

    await googleMapsAdapter.run(makeCtx({ log, llm, browser: session }));

    expect(lines.some((l) => /batch\(es\)/.test(l.message))).toBe(false);
  });

  it("enriches places in parallel tabs and closes the ones it opened", async () => {
    // Sequential enrichment was 203.8s of a 400s run: ten places at ~20s each,
    // most of it the LLM call rather than the page load.
    const names = ["A", "B", "C", "D"];
    const llm = new FakeLlmProvider({
      handler: (args) => {
        const isDetail = args.user.includes('\\"place\\"');
        const listed = isDetail ? ["A"] : names;
        return {
          places: listed.map((name) => ({
            name,
            address: `${names.indexOf(name) + 1} Rue Test`,
            evidence: [
              { requirementId: "celiac", claim: "c", polarity: "unclear", quote: "", confidence: 0.5 },
            ],
          })),
        };
      },
    });

    let opened = 0;
    let closed = 0;
    const evaluate = makeEvaluate(
      {
        results: names.map((n) => ({
          name: n,
          url: `https://www.google.com/maps/place/${n}`,
          snippet: n,
        })),
      },
      {
        href: "https://x/@45.58,-73.58,14z",
        place: { title: "A", website: "", reviewTopics: [], text: "x", url: "https://x" },
      },
    );
    const makePage = (): BrowserPage => ({
      goto: async () => undefined,
      waitForTimeout: async () => undefined,
      evaluate,
      content: async () => "<html></html>",
      close: async () => {
        closed += 1;
      },
    });
    const browser: BrowserSession = {
      sessionId: "s",
      mode: "live",
      recording: false,
      newPage: async () => {
        opened += 1;
        return makePage();
      },
      close: async () => undefined,
      getReplayUrl: async () => undefined,
      downloadReplay: async () => undefined,
    };

    await googleMapsAdapter.run(makeCtx({ llm, browser, requirements: [CELIAC] }));

    // run()'s own page, plus up to ENRICH_CONCURRENCY - 1 extra tabs.
    expect(opened).toBeGreaterThan(1);
    expect(opened).toBeLessThanOrEqual(3);
    // Every page opened is closed, all of them in run()'s `finally`.
    expect(closed).toBe(opened);
  });

  it("still enriches when the session refuses to open a second tab", async () => {
    // A session that will not open another tab is not a reason to fail; the one
    // page just does all the work.
    const { ctx, urls } = enrichmentCtx("unclear");

    await googleMapsAdapter.run(ctx);

    expect(urls.some((u) => u.includes("/maps/place/"))).toBe(true);
  });
});

describe("mapsPlaceUrl", () => {
  it("accepts a listing URL off a result card, including country domains", () => {
    const url =
      "https://www.google.com/maps/place/Cafe/data=!4m7!3m6!1s0x4cc9:0x7c70!8m2!3d45.53!4d-73.61";
    expect(mapsPlaceUrl(url)).toBe(url);
    expect(
      mapsPlaceUrl("https://www.google.ca/maps/place/Boulangerie/@45.5,-73.6,17z"),
    ).toBe("https://www.google.ca/maps/place/Boulangerie/@45.5,-73.6,17z");
  });

  it("rejects the search URL the extraction pass falls back to", () => {
    expect(
      mapsPlaceUrl("https://www.google.com/maps/search/gluten%20free/@45.5,-73.5,13z"),
    ).toBeUndefined();
  });

  it("rejects a host that merely contains google, and any non-https scheme", () => {
    expect(mapsPlaceUrl("https://google.evil.test/maps/place/X")).toBeUndefined();
    expect(mapsPlaceUrl("https://notgoogle.com/maps/place/X")).toBeUndefined();
    expect(mapsPlaceUrl("http://www.google.com/maps/place/X")).toBeUndefined();
    expect(mapsPlaceUrl("javascript:alert(1)")).toBeUndefined();
    expect(mapsPlaceUrl(undefined)).toBeUndefined();
  });
});

describe("mergeCards — one card per place, before any model sees it", () => {
  const url = (id: string) =>
    `https://www.google.com/maps/place/X/data=!4m7!3m6!1s${id}!8m2!3d45.5!4d-73.6`;

  it("merges a place two searches listed, keeping the snippet only the second one had", () => {
    const { cards, searchUrlOf } = mergeCards([
      {
        url: "https://maps/search/italian",
        cards: [{ name: "Ottavio", url: url("0x1:0xa"), snippet: "Italian · $$" }],
      },
      {
        url: "https://maps/search/gluten",
        cards: [{ name: "Ottavio", url: url("0x1:0xA"), snippet: '"great gluten free pasta"' }],
      },
    ]);
    expect(cards).toHaveLength(1);
    expect(cards[0]!.snippet).toBe("Italian · $$");
    expect(cards[0]!.otherSnippets).toEqual(['"great gluten free pasta"']);
    // Cited under the search that listed it first.
    expect(searchUrlOf.get("ottavio")).toBe("https://maps/search/italian");
  });

  it("keeps two branches of a chain apart, whatever their names", () => {
    const { cards } = mergeCards([
      {
        url: "s",
        cards: [
          { name: "Tim Hortons", url: url("0x1:0x1"), snippet: "a" },
          { name: "Tim Hortons", url: url("0x2:0x2"), snippet: "b" },
        ],
      },
    ]);
    expect(cards).toHaveLength(2);
  });

  it("leaves a card that was only seen once exactly as scraped, so its cache key holds", () => {
    const card = { name: "Solo", url: url("0x3:0x3"), snippet: "x", rating: 4.5 };
    const { cards } = mergeCards([{ url: "s", cards: [card] }]);
    expect(cards[0]).toEqual(card);
  });
});

describe("googleMapsAdapter — searches run side by side, and extract once", () => {
  it("asks the model once about a place two queries both listed", async () => {
    // Before: one extraction per query, so two calls for the same card.
    const { ctx } = manyResultsCtx(["Ottavio"], () => [], {
      queries: [
        { query: "sans gluten restaurant MTL", subject: "sans gluten restaurant" },
        { query: "Cuisine italienne restaurant MTL", subject: "Cuisine italienne restaurant" },
      ],
    });
    const llm = ctx.llm as FakeLlmProvider;

    await googleMapsAdapter.run(ctx);

    expect(llm.calls).toHaveLength(1);
  });

  it("loads the queries in parallel tabs, never two at once in one tab", async () => {
    let inFlight = 0;
    let peak = 0;
    let tabClash = false;
    const evaluate = makeEvaluate(
      { results: [{ name: "A", url: "https://www.google.com/maps/place/A", snippet: "A" }] },
      { href: "https://x/@45.58,-73.58,14z" },
    );
    const makePage = (): BrowserPage => {
      let busy = false;
      return {
        goto: async (target: string) => {
          if (!target.includes("/@")) return;
          if (busy) tabClash = true;
          busy = true;
          inFlight += 1;
          peak = Math.max(peak, inFlight);
          await new Promise((r) => setTimeout(r, 1_500));
          inFlight -= 1;
          busy = false;
        },
        waitForTimeout: async () => undefined,
        evaluate,
        content: async () => "<html></html>",
        close: async () => undefined,
      };
    };
    const browser: BrowserSession = {
      sessionId: "s",
      mode: "live",
      recording: false,
      newPage: async () => makePage(),
      close: async () => undefined,
      getReplayUrl: async () => undefined,
      downloadReplay: async () => undefined,
    };

    await googleMapsAdapter.run(
      makeCtx({
        browser,
        queries: [
          { query: "q1 MTL", subject: "q1" },
          { query: "q2 MTL", subject: "q2" },
          { query: "q3 MTL", subject: "q3" },
        ],
      }),
    );

    expect(peak).toBeGreaterThan(1);
    expect(tabClash).toBe(false);
  });
});

describe("googleMapsAdapter — scroll waits for cards, not for the clock", () => {
  function scrollCtx(grows: boolean): { ctx: AdapterContext; waits: number[] } {
    const counts = [7, 15, 22, 22];
    let call = 0;
    let last = 0;
    const waits: number[] = [];
    const page: BrowserPage = {
      goto: async () => undefined,
      waitForTimeout: async (ms: number) => {
        waits.push(ms);
      },
      evaluate: makeEvaluate(
        { results: [], rawCount: 22 },
        {
          scroll: () => {
            last = counts[Math.min(call++, counts.length - 1)]!;
            return { count: last, scrollable: true };
          },
          // The lazy load has already landed, or never does.
          count: () => (grows ? last + 1 : last),
        },
      ),
      content: async () => "<html></html>",
      close: async () => undefined,
    };
    const browser: BrowserSession = {
      sessionId: "s",
      mode: "live",
      recording: false,
      newPage: async () => page,
      close: async () => undefined,
      getReplayUrl: async () => undefined,
      downloadReplay: async () => undefined,
    };
    return { ctx: makeCtx({ browser }), waits };
  }

  it("moves straight on once the new cards are there", async () => {
    const { ctx, waits } = scrollCtx(true);
    await googleMapsAdapter.run(ctx);
    expect(waits).toEqual([]);
  });

  it("still waits when the lazy load has not landed yet", async () => {
    // The distinguishing case for the one above: same feed, cards slow to come.
    const { ctx, waits } = scrollCtx(false);
    await googleMapsAdapter.run(ctx);
    expect(waits.length).toBeGreaterThan(0);
  });
});

describe("googleMapsAdapter — skipping pages that cannot change the outcome", () => {
  const ALLERGY: PlannedRequirement = {
    id: "allergy",
    catalogId: "allergy",
    label: "Allergy",
    intentIds: ["dining"],
    must: [],
    nice: [],
    weight: 3,
    satisfiedBy: [],
  };

  /** "Strong" is settled on both chips from its card. "Weak" is open on
   *  celiac and already contradicted on the allergy, so even a detail page
   *  that confirmed celiac outright would leave it at 6.3 against Strong's
   *  10.8. */
  function boundCtx(limit: number): { ctx: AdapterContext; urls: string[]; lines: { message: string }[] } {
    return manyResultsCtx(
      ["Strong", "Weak"],
      (name) =>
        name === "Strong"
          ? [
              { requirementId: "celiac", polarity: "supports", confidence: 0.9 },
              { requirementId: "allergy", polarity: "supports", confidence: 0.9 },
            ]
          : [
              { requirementId: "celiac", polarity: "unclear", confidence: 0.5 },
              { requirementId: "allergy", polarity: "contradicts", confidence: 0.9 },
            ],
      { limit, requirements: [CELIAC, ALLERGY] },
    );
  }

  it("does not open a place that could not make the cut whatever its page said", async () => {
    const { ctx, urls, lines } = boundCtx(1);

    await googleMapsAdapter.run(ctx);

    expect(urls.some((u) => u.includes("/maps/place/Weak"))).toBe(false);
    expect(lines.some((l) => /Weak: not opened/.test(l.message))).toBe(true);
  });

  it("still opens it when there is room for it in the results", async () => {
    // Same places, one more slot: now its page could get it in.
    const { ctx, urls } = boundCtx(2);

    await googleMapsAdapter.run(ctx);

    expect(urls.some((u) => u.includes("/maps/place/Weak"))).toBe(true);
  });
});

describe("googleMapsAdapter — a website hop for a photo alone makes no model call", () => {
  it("takes the photo and skips the extraction when everything is settled", async () => {
    const { ctx } = enrichmentCtx("unclear", {}, "supports", "", "Entièrement sans gluten");
    const llm = ctx.llm as FakeLlmProvider;

    const result = await googleMapsAdapter.run(ctx);

    expect(result.findings[0]!.place.thumbnailUrl).toBe("https://panella.ca/og.jpg");
    // The results page and the detail page. No third call for the website.
    expect(llm.calls).toHaveLength(2);
  });

  it("does read the website when a requirement is still open", async () => {
    const { ctx } = enrichmentCtx("unclear", {}, "unclear", "", "Entièrement sans gluten");
    const llm = ctx.llm as FakeLlmProvider;

    await googleMapsAdapter.run(ctx);

    expect(llm.calls).toHaveLength(3);
  });
});

describe("cutByDistance — a place well outside the radius is not worth reading", () => {
  const center = { lat: 45.58, lng: -73.58 };
  // One degree of latitude is ~111 km, so these sit this far due north.
  const at = (km: number) =>
    `https://www.google.com/maps/place/X/data=!3d${(45.58 + km / 111.2).toFixed(6)}!4d-73.580000`;

  it("keeps a place just past the radius and drops one past half again", () => {
    const { kept, dropped, cutoffKm } = cutByDistance(
      [
        { name: "inside", url: at(2) },
        { name: "just past", url: at(4) },
        { name: "far", url: at(6) },
      ],
      center,
      3,
    );
    expect(cutoffKm).toBe(4.5);
    expect(kept.map((c) => c.name)).toEqual(["inside", "just past"]);
    expect(dropped).toBe(1);
  });

  it("caps the overshoot at 10 km on a wide search", () => {
    const { kept } = cutByDistance(
      [
        { name: "105 km", url: at(105) },
        { name: "115 km", url: at(115) },
      ],
      center,
      100,
    );
    expect(kept.map((c) => c.name)).toEqual(["105 km"]);
  });

  it("keeps a place it cannot locate, and cuts nothing without a centre", () => {
    expect(cutByDistance([{ url: "https://www.google.com/maps/place/X" }], center, 3).dropped).toBe(0);
    expect(cutByDistance([{ url: at(50) }], undefined, 3).dropped).toBe(0);
  });
});

describe("googleMapsAdapter — the distance cut happens before extraction", () => {
  it("never shows the model a place past the cutoff, and says how many it left out", async () => {
    const { lines, log } = recorder();
    const llm = new FakeLlmProvider({ handler: () => ({ places: [] }) });
    const card = (name: string, km: number) => ({
      name,
      url: `https://www.google.com/maps/place/${name}/data=!3d${(45.58 + km / 111.2).toFixed(6)}!4d-73.580000`,
      snippet: name,
    });
    const { session } = makeRecordingSession(
      makeEvaluate(
        { results: [card("NearbyCafe", 1), card("JustPastCafe", 4), card("FarAwayCafe", 8)] },
        { href: "https://x/@45.580000,-73.580000,14z" },
      ),
    );

    // The default radius is 3 km, so the cutoff is 4.5 km.
    await googleMapsAdapter.run(makeCtx({ log, llm, browser: session }));

    const prompt = llm.calls.map((c) => c.user).join("\n");
    expect(prompt).toContain("NearbyCafe");
    // Past the radius but inside the cutoff: still read, still ranked.
    expect(prompt).toContain("JustPastCafe");
    expect(prompt).not.toContain("FarAwayCafe");
    expect(lines.some((l) => /left out 1 place\(s\) more than 4\.5 km/.test(l.message))).toBe(true);
  });
});

describe("extractionBatchCount — spread across every slot, not packed", () => {
  it("uses one call for a handful, and all three slots once there are enough", () => {
    expect(extractionBatchCount(0)).toBe(0);
    expect(extractionBatchCount(3)).toBe(1);
    expect(extractionBatchCount(8)).toBe(2);
    expect(extractionBatchCount(12)).toBe(3);
    expect(extractionBatchCount(20)).toBe(3);
    // Past three full batches, the size cap takes over again.
    expect(extractionBatchCount(30)).toBe(4);
  });
});

describe("googleMapsAdapter — the model is shown text, not URLs", () => {
  it("keeps listing URLs out of the prompt and sets the place link from the card", async () => {
    const llm = new FakeLlmProvider({
      handler: () => ({
        places: [
          // Whatever the model claims the link is, it was never shown one.
          { name: "Ottavio", address: "1 Rue Test", url: "https://invented.example/", evidence: [] },
        ],
      }),
    });
    const listing =
      "https://www.google.com/maps/place/Ottavio/data=!4m7!3m6!1s0x4cc9:0x1b0b!8m2!3d45.5956987!4d-73.5708881";
    const { session } = makeRecordingSession(
      makeEvaluate(
        { results: [{ name: "Ottavio", url: listing, snippet: "Italienne" }] },
        { href: "https://x/@45.58,-73.58,14z" },
      ),
    );

    const result = await googleMapsAdapter.run(makeCtx({ llm, browser: session }));

    expect(llm.calls.every((c) => !c.user.includes("/maps/place/"))).toBe(true);
    expect(result.findings[0]!.place.url).toBe(listing);
    expect(result.findings[0]!.place.lat).toBeCloseTo(45.5956987, 6);
  });

  it("sends a detail page by name and without its listing URL", async () => {
    const { ctx } = enrichmentCtx("unclear");
    const llm = ctx.llm as FakeLlmProvider;

    await googleMapsAdapter.run(ctx);

    const detailCall = llm.calls.find((c) => c.user.includes("sans gluten, mentionn"));
    expect(detailCall).toBeDefined();
    expect(detailCall!.user).toContain("Cantine Panella");
    expect(detailCall!.user).not.toContain("/maps/place/");
  });
});
