// The OpenStreetMap adapter: deterministic tag -> evidence, a bounded Overpass
// query, and the outage path that reports a missing source instead of padding
// the dossier with recorded places from elsewhere. Every test injects
// `ctx.fetch` — nothing here touches the network, and `defaultAdapterFetch()`
// refuses outright under vitest so a forgotten injection fails closed rather
// than silently reaching Overpass from CI.
import { beforeAll, describe, expect, it } from "vitest";
import { FakeLlmProvider } from "@sensitiv/shared/llm";
import { LocationSchema, type PlannedRequirement } from "@sensitiv/shared";
import {
  buildOverpassQuery,
  evidenceForTags,
  findingForElement,
  __setOverpassRetryDelay,
  openStreetMapAdapter,
  searchableTagFilters,
} from "./openstreetmap.ts";
import { defaultAdapterFetch, NETWORK_DISABLED_MESSAGE } from "../http.ts";
import { FixtureBrowserSession } from "../browser/fixture.ts";
import { canonicalKey } from "../merge.ts";
import { EXPLICIT_MARK_CONFIDENCE, scorePlace } from "@sensitiv/shared";
import type { AdapterContext } from "./types.ts";
import type { JobLogLevel } from "../logger.ts";

const CELIAC: PlannedRequirement = {
  id: "celiac",
  catalogId: "celiac",
  label: "Celiac",
  intentIds: ["dining"],
  must: ["dedicated gluten-free kitchen"],
  nice: [],
  weight: 3,
  satisfiedBy: [],
};

const ACCESS: PlannedRequirement = {
  id: "access",
  catalogId: "access",
  label: "Wheelchair access",
  intentIds: ["dining"],
  must: ["step-free entrance"],
  nice: [],
  weight: 3,
  satisfiedBy: [],
};

const HALAL: PlannedRequirement = {
  ...CELIAC,
  id: "diet",
  catalogId: "diet",
  label: "Special diet",
  diet: "halal",
  weight: 2,
};

/** A planned requirement the planner invented from free text. */
const CUSTOM: PlannedRequirement = {
  id: "custom_italian",
  label: "Italian",
  intentIds: ["dining"],
  must: [],
  nice: [],
  weight: 1,
  satisfiedBy: [],
};

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

function makeCtx(overrides: Partial<AdapterContext> = {}): AdapterContext {
  const { log } = recorder();
  return {
    jobId: "job-1",
    intentIds: ["dining"],
    location: LocationSchema.parse({
      query: "Plateau-Mont-Royal, Montreal",
      country: "CA",
      lat: 45.5233,
      lng: -73.5858,
      radiusKm: 2,
    }),
    searchLang: { code: "en", source: "auto" },
    uiLocale: "en",
    requirements: [CELIAC],
    queries: [{ query: "gluten free restaurant Montreal", subject: "gluten free restaurant" }],
    limit: 8,
    browser: new FixtureBrowserSession(),
    fetch: () => Promise.reject(new Error("no network in tests")),
    llm: new FakeLlmProvider(),
    log,
    signal: new AbortController().signal,
    ...overrides,
  };
}

/** An Overpass response, as `fetch` would hand it back. */
function overpassOk(elements: unknown[]): typeof fetch {
  return (() =>
    Promise.resolve(
      new Response(JSON.stringify({ elements }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    )) as unknown as typeof fetch;
}

const PARC_SANS_GLUTEN = {
  type: "node",
  id: 3908631938,
  lat: 45.5244576,
  lon: -73.5726075,
  tags: {
    name: "Parc Sans Gluten",
    shop: "bakery",
    "diet:gluten_free": "only",
    wheelchair: "no",
    check_date: "2024-06-16",
    "addr:housenumber": "4050",
    "addr:street": "Avenue du Parc-La Fontaine",
    website: "https://www.parcsansgluten.ca/",
    phone: "+1-438-476-0648",
  },
};

describe("the outbound-HTTP guard", () => {
  it("the DEFAULT fetch refuses to reach the network under the test runner", async () => {
    // The same fail-closed rule `solari.ts` applies to its module loader. Without
    // it, an adapter that forgot its injected fetch would quietly call a real
    // third-party endpoint from CI and the suite would still be green.
    await expect(defaultAdapterFetch()("https://overpass-api.de/")).rejects.toThrow(
      NETWORK_DISABLED_MESSAGE,
    );
  });
});

describe("requirement -> OSM tag mapping", () => {
  it("maps the catalog requirements OSM actually tags, and nothing else", () => {
    expect(searchableTagFilters([CELIAC])).toEqual([
      '["diet:gluten_free"~"^(only|yes|limited)$"]',
    ]);
    expect(searchableTagFilters([ACCESS])).toEqual(['["wheelchair"~"^(yes|designated)$"]']);
    expect(searchableTagFilters([HALAL])).toEqual([
      '["diet:halal"~"^(only|yes|limited)$"]',
    ]);
  });

  it("says nothing about requirements OSM has no convention for", () => {
    // `allergy` and `mold` have no trustworthy OSM tagging, and a diet the
    // community does not tag (Low-FODMAP) resolves to no key at all. Silence is
    // the honest output — inventing a reading from `cuisine` would not be.
    const allergy: PlannedRequirement = { ...CELIAC, id: "allergy", catalogId: "allergy" };
    const mold: PlannedRequirement = { ...CELIAC, id: "mold", catalogId: "mold" };
    const fodmap: PlannedRequirement = { ...HALAL, diet: "low_fodmap" };
    expect(searchableTagFilters([allergy, mold, fodmap])).toEqual([]);
  });

  it("ignores a requirement the catalog never produced (fail closed)", () => {
    // `custom_<slug>` requirements are free text the planner invented. The
    // table is keyed by CATALOG id and looked up, never switched on, so an id
    // it does not know is simply not researched here.
    expect(searchableTagFilters([CUSTOM])).toEqual([]);
  });
});

describe("buildOverpassQuery", () => {
  const center = { lat: 45.5233, lng: -73.5858 };

  it("unions every (venue type x requirement tag) pair and bounds the result", () => {
    const query = buildOverpassQuery({
      intentIds: ["dining"],
      requirements: [CELIAC],
      center,
      radiusKm: 2,
    });
    expect(query).toBeDefined();
    expect(query).toContain("[out:json][timeout:25];");
    // Two venue filters for dining (amenity + shop), one tag -> two clauses.
    expect(query?.match(/nwr/g)).toHaveLength(2);
    expect(query).toContain('["diet:gluten_free"~"^(only|yes|limited)$"]');
    expect(query).toContain("(around:2000,45.523300,-73.585800)");
    expect(query).toContain("out center 200;");
  });

  it("clamps an absurd radius rather than asking Overpass to scan a province", () => {
    const query = buildOverpassQuery({
      intentIds: ["dining"],
      requirements: [CELIAC],
      center,
      radiusKm: 500,
    });
    expect(query).toContain("(around:25000,");
  });

  it("returns nothing when no intent or no requirement maps", () => {
    expect(
      buildOverpassQuery({
        intentIds: ["housing"],
        requirements: [CELIAC],
        center,
        radiusKm: 2,
      }),
    ).toBeUndefined();
    expect(
      buildOverpassQuery({
        intentIds: ["dining"],
        requirements: [CUSTOM],
        center,
        radiusKm: 2,
      }),
    ).toBeUndefined();
  });
});

describe("evidenceForTags — deterministic, no LLM", () => {
  const sourceUrl = "https://www.openstreetmap.org/node/1";

  it("quotes the tag verbatim, which is what removes the fabricated-quote problem", () => {
    const [evidence] = evidenceForTags({
      tags: { "diet:gluten_free": "only" },
      requirements: [CELIAC],
      uiLocale: "en",
      sourceUrl,
    });
    // `extract.ts` has to check model-written quotes against the blob they came
    // from. Here the quote IS the source text, so it is verbatim by construction.
    expect(evidence?.quote).toBe("diet:gluten_free=only");
    expect(evidence?.source).toBe("openstreetmap");
    expect(evidence?.sourceUrl).toBe(sourceUrl);
    expect(evidence?.polarity).toBe("supports");
  });

  it("does NOT report gluten-free OPTIONS as an explicit mark of kitchen safety", () => {
    // The judgement this whole table exists to encode. `diet:gluten_free=yes`
    // means options are available; the celiac requirement's must is a dedicated
    // kitchen. Scoring the first as the second is the precise error this app
    // exists to avoid, so `yes` sits deliberately below the explicit threshold
    // while `only` — an entirely gluten-free venue — sits above it.
    const [options] = evidenceForTags({
      tags: { "diet:gluten_free": "yes" },
      requirements: [CELIAC],
      uiLocale: "en",
      sourceUrl,
    });
    const [dedicated] = evidenceForTags({
      tags: { "diet:gluten_free": "only" },
      requirements: [CELIAC],
      uiLocale: "en",
      sourceUrl,
    });
    expect(options?.confidence).toBeLessThan(EXPLICIT_MARK_CONFIDENCE);
    expect(dedicated?.confidence).toBeGreaterThanOrEqual(EXPLICIT_MARK_CONFIDENCE);

    const optionsScore = scorePlace(options ? [options] : [], { requirements: [CELIAC] });
    const dedicatedScore = scorePlace(dedicated ? [dedicated] : [], {
      requirements: [CELIAC],
    });
    expect(dedicatedScore.score).toBeGreaterThan(optionsScore.score);

    // NEITHER is reported as an explicit mark, and that is a second, stronger
    // rule on top of this table's own judgement: `SOURCE_RELIABILITY` discounts
    // every OpenStreetMap claim, so even `only` at 0.95 lands at 0.665 — below
    // the threshold. No tag a volunteer typed, unreviewed and undated, gets to
    // stand as an explicit mark that a kitchen is safe for a coeliac.
    expect(optionsScore.breakdown[0]?.rule).toBe("supported");
    expect(dedicatedScore.breakdown[0]?.rule).toBe("supported");
    expect(dedicatedScore.breakdown[0]?.discounted).toBe(true);
  });

  it("reads a negative tag as contradicting, which is the whole point of a second source", () => {
    const [evidence] = evidenceForTags({
      tags: { wheelchair: "no" },
      requirements: [ACCESS],
      uiLocale: "en",
      sourceUrl,
    });
    expect(evidence?.polarity).toBe("contradicts");
    expect(evidence?.quote).toBe("wheelchair=no");
  });

  it("treats `limited` as unclear rather than as either verdict", () => {
    const [evidence] = evidenceForTags({
      tags: { "diet:gluten_free": "limited" },
      requirements: [CELIAC],
      uiLocale: "en",
      sourceUrl,
    });
    expect(evidence?.polarity).toBe("unclear");
  });

  it("skips a tag value outside the documented vocabulary instead of guessing", () => {
    // OSM values are open-ended. `ask_staff` is real and says something, but not
    // something this table can state, so it must produce no evidence at all
    // rather than a guess that becomes a stored claim.
    expect(
      evidenceForTags({
        tags: { "diet:gluten_free": "ask_staff" },
        requirements: [CELIAC],
        uiLocale: "en",
        sourceUrl,
      }),
    ).toEqual([]);
  });

  it("keeps OSM's own check_date as the evidence date, but only when it is a date", () => {
    const [dated] = evidenceForTags({
      tags: { "diet:gluten_free": "only", check_date: "2024-06-16" },
      requirements: [CELIAC],
      uiLocale: "en",
      sourceUrl,
    });
    expect(dated?.date).toBe("2024-06-16");
    const [vague] = evidenceForTags({
      tags: { "diet:gluten_free": "only", check_date: "summer 2024" },
      requirements: [CELIAC],
      uiLocale: "en",
      sourceUrl,
    });
    expect(vague?.date).toBeUndefined();
  });

  it("writes the claim in the reader's locale", () => {
    const [en] = evidenceForTags({
      tags: { "diet:gluten_free": "only" },
      requirements: [CELIAC],
      uiLocale: "en",
      sourceUrl,
    });
    const [fr] = evidenceForTags({
      tags: { "diet:gluten_free": "only" },
      requirements: [{ ...CELIAC, label: "Maladie cœliaque" }],
      uiLocale: "fr",
      sourceUrl,
    });
    expect(en?.claim).toContain("Celiac");
    expect(en?.claim).toMatch(/entirely dedicated/i);
    expect(fr?.claim).toContain("Maladie cœliaque");
    expect(fr?.claim).toMatch(/entièrement dédié/i);
  });

  it("answers several requirements off one element, including disagreeing ones", () => {
    const evidence = evidenceForTags({
      tags: PARC_SANS_GLUTEN.tags,
      requirements: [CELIAC, ACCESS],
      uiLocale: "en",
      sourceUrl,
    });
    expect(evidence).toHaveLength(2);
    expect(evidence.find((e) => e.requirementId === "celiac")?.polarity).toBe("supports");
    expect(evidence.find((e) => e.requirementId === "access")?.polarity).toBe(
      "contradicts",
    );
  });
});

describe("findingForElement", () => {
  it("builds a place whose canonical key matches what the merge computes", () => {
    // This is the entire reason a second source is worth having: it has to
    // collapse onto the same key `google_maps` produces, or the two never meet.
    const finding = findingForElement(PARC_SANS_GLUTEN as never, {
      requirements: [CELIAC],
      uiLocale: "en",
    });
    expect(finding?.place.canonicalKey).toBe(
      canonicalKey("Parc Sans Gluten", "4050 Avenue du Parc-La Fontaine"),
    );
    expect(finding?.place.lat).toBeCloseTo(45.5244576, 5);
    expect(finding?.source.sourceUrl).toBe(
      "https://www.openstreetmap.org/node/3908631938",
    );
    // OSM has no ratings. Inventing a proxy would be a number that looks like a
    // rating and is not one.
    expect(finding?.source.rating).toBeUndefined();
    expect(finding?.source.reviewCount).toBeUndefined();
  });

  it("takes a way's centre when it has no node coordinates", () => {
    const finding = findingForElement(
      {
        type: "way",
        id: 42,
        center: { lat: 45.5, lon: -73.6 },
        tags: { name: "Café Way", amenity: "cafe", "diet:gluten_free": "only" },
      } as never,
      { requirements: [CELIAC], uiLocale: "en" },
    );
    expect(finding?.place.lat).toBe(45.5);
    expect(finding?.place.lng).toBe(-73.6);
  });

  it("drops an unnamed element and one with no readable evidence", () => {
    expect(
      findingForElement(
        { type: "node", id: 1, lat: 1, lon: 1, tags: { "diet:gluten_free": "only" } } as never,
        { requirements: [CELIAC], uiLocale: "en" },
      ),
    ).toBeUndefined();
    expect(
      findingForElement(
        { type: "node", id: 2, lat: 1, lon: 1, tags: { name: "Plain Cafe" } } as never,
        { requirements: [CELIAC], uiLocale: "en" },
      ),
    ).toBeUndefined();
  });

  it("refuses a website tag that is not a safe external URL", () => {
    // `website=` is free text someone typed into OSM, and it becomes an `href`
    // in the dossier.
    for (const hostile of [
      "javascript:alert(1)",
      "http://169.254.169.254/latest/meta-data/",
      "http://localhost:8080/",
      "not a url",
    ]) {
      const finding = findingForElement(
        {
          type: "node",
          id: 3,
          lat: 1,
          lon: 1,
          tags: { name: "Hostile", "diet:gluten_free": "only", website: hostile },
        } as never,
        { requirements: [CELIAC], uiLocale: "en" },
      );
      expect(finding?.place.url).toBeUndefined();
    }
  });
});

describe("openStreetMapAdapter.run", () => {
  beforeAll(() => __setOverpassRetryDelay(0));

  it("supports the intents it has venue filters for, and no others", () => {
    expect(openStreetMapAdapter.supports("dining")).toBe(true);
    expect(openStreetMapAdapter.supports("grocery")).toBe(true);
    expect(openStreetMapAdapter.supports("housing")).toBe(false);
    expect(openStreetMapAdapter.supports("services")).toBe(false);
  });

  it("never opens a browser session", () => {
    // A live Solari session is paid, recorded and rate-limited. This adapter
    // reads an API, so the runner must not launch one for it.
    expect(openStreetMapAdapter.needsBrowser).toBe(false);
  });

  it("POSTs to Overpass only, identifies itself, and refuses redirects", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = ((url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return Promise.resolve(
        new Response(JSON.stringify({ elements: [PARC_SANS_GLUTEN] }), { status: 200 }),
      );
    }) as unknown as typeof fetch;

    const result = await openStreetMapAdapter.run(makeCtx({ fetch: fetchImpl }));

    expect(calls).toHaveLength(1);
    // A constant, never assembled from job input — the same SSRF rule
    // `/api/geocode` follows.
    expect(calls[0]?.url).toBe("https://overpass-api.de/api/interpreter");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(
      (calls[0]?.init?.headers as Record<string, string>)["user-agent"],
    ).toMatch(/^Sensitiv\//);
    // A followed redirect would walk the request off the allowlisted origin.
    expect(calls[0]?.init?.redirect).toBe("error");
    expect(result.findings).toHaveLength(1);
    expect(result.mode).toBe("live");
  });

  it("reports mode live so a real run is not filed under 'not searched'", async () => {
    // `needsBrowser: false` makes the runner assume `"stub"` — the value
    // reserved for the v1.1 no-ops, which the dossier renders as "not
    // implemented yet". A source that genuinely ran has to say so itself.
    const result = await openStreetMapAdapter.run(
      makeCtx({ fetch: overpassOk([PARC_SANS_GLUTEN]) }),
    );
    expect(result.mode).toBe("live");
  });

  it("collapses the same place arriving through more than one union clause", async () => {
    const result = await openStreetMapAdapter.run(
      makeCtx({ fetch: overpassOk([PARC_SANS_GLUTEN, PARC_SANS_GLUTEN]) }),
    );
    expect(result.findings).toHaveLength(1);
  });

  it("orders by distance from the search centre and honours the limit", async () => {
    const near = {
      type: "node",
      id: 10,
      lat: 45.5235,
      lon: -73.586,
      tags: { name: "Near Cafe", amenity: "cafe", "diet:gluten_free": "only" },
    };
    const far = {
      type: "node",
      id: 11,
      lat: 45.56,
      lon: -73.62,
      tags: { name: "Far Cafe", amenity: "cafe", "diet:gluten_free": "only" },
    };
    const result = await openStreetMapAdapter.run(
      makeCtx({ fetch: overpassOk([far, near]), limit: 1 }),
    );
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.place.name).toBe("Near Cafe");
  });

  it("says so, rather than failing, when nothing in the run maps to a tag", async () => {
    const rec = recorder();
    const allergy: PlannedRequirement = { ...CELIAC, id: "allergy", catalogId: "allergy" };
    const result = await openStreetMapAdapter.run(
      makeCtx({ requirements: [allergy], log: rec.log }),
    );
    expect(result.findings).toEqual([]);
    // Not unavailable: "OSM has no tag for what you asked" is a complete
    // answer, not an outage the dossier should warn about.
    expect(result.mode).toBe("live");
    expect(rec.lines.some((l) => /maps to an OpenStreetMap tag/i.test(l.message))).toBe(
      true,
    );
  });

  it("retries the main server when it flaps, before bothering the mirror", async () => {
    let calls = 0;
    const urls: string[] = [];
    const fetchImpl = ((url: string | URL) => {
      urls.push(String(url));
      calls += 1;
      return Promise.resolve(
        calls === 1
          ? new Response("Gateway Timeout", { status: 504 })
          : new Response(JSON.stringify({ elements: [PARC_SANS_GLUTEN] }), { status: 200 }),
      );
    }) as unknown as typeof fetch;

    const result = await openStreetMapAdapter.run(makeCtx({ fetch: fetchImpl }));

    expect(urls).toEqual([
      "https://overpass-api.de/api/interpreter",
      "https://overpass-api.de/api/interpreter",
    ]);
    expect(result.mode).toBe("live");
  });

  it("asks the mirror when the main server stays overloaded, and says which answered", async () => {
    const rec = recorder();
    const urls: string[] = [];
    const fetchImpl = ((url: string | URL) => {
      urls.push(String(url));
      if (String(url).includes("overpass-api.de")) {
        return Promise.resolve(new Response("Gateway Timeout", { status: 504 }));
      }
      return Promise.resolve(
        new Response(JSON.stringify({ elements: [PARC_SANS_GLUTEN] }), { status: 200 }),
      );
    }) as unknown as typeof fetch;

    const result = await openStreetMapAdapter.run(makeCtx({ log: rec.log, fetch: fetchImpl }));

    expect(urls).toEqual([
      "https://overpass-api.de/api/interpreter",
      "https://overpass-api.de/api/interpreter",
      "https://overpass-api.de/api/interpreter",
      "https://overpass.private.coffee/api/interpreter",
    ]);
    expect(result.mode).toBe("live");
    expect(result.findings.map((f) => f.place.name)).toEqual(["Parc Sans Gluten"]);
    expect(
      rec.lines.some((l) => /answered from overpass\.private\.coffee.*HTTP 504/i.test(l.message)),
    ).toBe(true);
  });

  it("does not ask the mirror to run a query the main server rejected as bad", async () => {
    const urls: string[] = [];
    const fetchImpl = ((url: string | URL) => {
      urls.push(String(url));
      return Promise.resolve(new Response("syntax error", { status: 400 }));
    }) as unknown as typeof fetch;

    const result = await openStreetMapAdapter.run(makeCtx({ fetch: fetchImpl }));

    expect(urls).toHaveLength(1);
    expect(result.mode).toBe("unavailable");
  });

  it("returns NOTHING, marked unavailable, when every server is down — never sample data", async () => {
    const rec = recorder();
    const result = await openStreetMapAdapter.run(
      makeCtx({
        log: rec.log,
        fetch: (() =>
          Promise.resolve(new Response("Gateway Timeout", { status: 504 }))) as unknown as typeof fetch,
      }),
    );
    // Job ad8a5660: a 504 used to substitute a recorded Plateau response, and
    // its places ranked #1 in a Ville-Marie dossier. An outage is a missing
    // source, which the dossier names — not a reason to show somewhere else.
    expect(result.findings).toEqual([]);
    expect(result.mode).toBe("unavailable");
    expect(
      rec.lines.some(
        (l) =>
          l.level === "warn" &&
          /(overpass-api\.de: HTTP 504; ){3}overpass\.private\.coffee: HTTP 504/.test(l.message),
      ),
    ).toBe(true);
    expect(rec.lines.some((l) => /sample data/i.test(l.message))).toBe(false);
  });

  it("treats an HTML error page with a 200 as a server failure, not a result", async () => {
    const result = await openStreetMapAdapter.run(
      makeCtx({
        fetch: (() =>
          Promise.resolve(new Response("<html>busy</html>", { status: 200 }))) as unknown as typeof fetch,
      }),
    );
    expect(result).toEqual({ findings: [], mode: "unavailable" });
  });

  it("lets the run's own timeout through instead of calling it an outage", async () => {
    const controller = new AbortController();
    const fetchImpl = ((_url: string | URL, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
        controller.abort();
      })) as unknown as typeof fetch;

    await expect(
      openStreetMapAdapter.run(makeCtx({ fetch: fetchImpl, signal: controller.signal })),
    ).rejects.toThrow(/abort/i);
  });

  it("reports unavailable when the location cannot be placed on a map", async () => {
    const rec = recorder();
    // No coordinates on the job (the postal-code case, where the form withholds
    // them on purpose) AND no geocode available.
    const result = await openStreetMapAdapter.run(
      makeCtx({
        log: rec.log,
        location: LocationSchema.parse({ query: "H2T", postalCode: "H2T", country: "CA" }),
        fetch: (() => Promise.reject(new Error("offline"))) as unknown as typeof fetch,
      }),
    );
    expect(result).toEqual({ findings: [], mode: "unavailable" });
    expect(
      rec.lines.some((l) => /could not resolve a searchable centre/i.test(l.message)),
    ).toBe(true);
  });

  it("refuses a Nominatim match too coarse to search", async () => {
    const rec = recorder();
    // "Quebec, Canada" resolves to the PROVINCE, centroid in boreal forest
    // ~700 km from anywhere a person eats. Searching 2 km around it is worse
    // than not searching.
    const fetchImpl = ((url: string | URL) => {
      if (String(url).includes("nominatim")) {
        return Promise.resolve(
          new Response(
            JSON.stringify([
              { lat: "52.476", lon: "-71.826", boundingbox: ["44.9", "62.6", "-79.7", "-57.1"] },
            ]),
            { status: 200 },
          ),
        );
      }
      return Promise.reject(new Error("should not reach Overpass"));
    }) as unknown as typeof fetch;

    const result = await openStreetMapAdapter.run(
      makeCtx({
        log: rec.log,
        location: LocationSchema.parse({ query: "Quebec, Canada", country: "CA" }),
        fetch: fetchImpl,
      }),
    );
    expect(result).toEqual({ findings: [], mode: "unavailable" });
    expect(rec.lines.some((l) => /region too large to search/i.test(l.message))).toBe(
      true,
    );
  });
});
