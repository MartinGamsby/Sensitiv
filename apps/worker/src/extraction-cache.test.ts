import { afterEach, describe, expect, it } from "vitest";
import { FakeLlmProvider } from "@sensitiv/shared/llm";
import type { PlannedRequirement, SearchLanguage } from "@sensitiv/shared";
import { cacheableUnits, extractFindings, nameOf } from "./extract.ts";
import {
  canonicalJson,
  createExtractionCache,
  extractionCacheKey,
  requirementsFingerprint,
  type ExtractionCache,
} from "./extraction-cache.ts";
import type { PlaceFinding } from "./adapters/types.ts";
import { makeDb, type TestDb } from "../test/helpers.ts";

let handle: TestDb | undefined;
afterEach(() => {
  handle?.client.close();
  handle = undefined;
});

const noopLog = async (): Promise<void> => undefined;
const searchLang: SearchLanguage = { code: "fr", source: "auto" };

const celiac: PlannedRequirement = {
  id: "celiac",
  catalogId: "celiac",
  label: "Celiac",
  intentIds: ["dining"],
  must: ["dedicated gluten-free kitchen"],
  nice: [],
  weight: 3,
  satisfiedBy: ["the venue is entirely gluten-free"],
};
const access: PlannedRequirement = {
  id: "access",
  catalogId: "access",
  label: "Step-free entrance",
  intentIds: ["dining"],
  must: ["step-free entrance"],
  nice: [],
  weight: 2,
  satisfiedBy: [],
};

const keyArgs = {
  source: "google_maps",
  requirements: [celiac],
  uiLocale: "en" as const,
  searchLang,
};

/** An in-memory cache that records what it was asked to store. */
function memoryCache(seed: Record<string, PlaceFinding[]> = {}) {
  const store = new Map<string, PlaceFinding[]>(Object.entries(seed));
  const puts: Array<{ key: string; findings: PlaceFinding[] }> = [];
  const cache: ExtractionCache = {
    async get(keys) {
      const out = new Map<string, PlaceFinding[]>();
      for (const key of keys) {
        const hit = store.get(key);
        if (hit) out.set(key, hit);
      }
      return out;
    },
    async put(entries) {
      for (const entry of entries) {
        puts.push(entry);
        store.set(entry.key, entry.findings);
      }
    },
  };
  return { cache, store, puts };
}

describe("canonicalJson", () => {
  it("is insensitive to property order at every level", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(
      canonicalJson({ a: { c: 3, d: 2 }, b: 1 }),
    );
  });

  it("is SENSITIVE to array order, which carries meaning", () => {
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });
});

describe("extractionCacheKey", () => {
  const card = { name: "Cafe A", text: "Restaurant sans gluten" };

  it("is stable for the same question", () => {
    expect(extractionCacheKey(card, keyArgs)).toBe(
      extractionCacheKey({ text: "Restaurant sans gluten", name: "Cafe A" }, keyArgs),
    );
  });

  it("changes when the scraped content changes at all", () => {
    expect(extractionCacheKey({ ...card, text: "Restaurant" }, keyArgs)).not.toBe(
      extractionCacheKey(card, keyArgs),
    );
  });

  it("changes when the run is looking for something else", () => {
    // The same card extracted for celiac and for celiac + access are different
    // questions with different answers; the second must never get the first's.
    expect(
      extractionCacheKey(card, { ...keyArgs, requirements: [celiac, access] }),
    ).not.toBe(extractionCacheKey(card, keyArgs));
  });

  it("changes with the locale and the search language, which shape the output", () => {
    expect(extractionCacheKey(card, { ...keyArgs, uiLocale: "fr" })).not.toBe(
      extractionCacheKey(card, keyArgs),
    );
    expect(
      extractionCacheKey(card, {
        ...keyArgs,
        searchLang: { code: "en", source: "auto" },
      }),
    ).not.toBe(extractionCacheKey(card, keyArgs));
  });

  it("changes with the source — two adapters are not interchangeable", () => {
    expect(extractionCacheKey(card, { ...keyArgs, source: "yelp" })).not.toBe(
      extractionCacheKey(card, keyArgs),
    );
  });

  it("does NOT change when only a requirement's weight is re-tuned", () => {
    // Weight is applied later, by `scorePlace`. Re-weighting must not throw
    // away a perfectly good extraction.
    expect(
      extractionCacheKey(card, {
        ...keyArgs,
        requirements: [{ ...celiac, weight: 99 }],
      }),
    ).toBe(extractionCacheKey(card, keyArgs));
  });

  it("orders requirements so the planner's ordering cannot split the cache", () => {
    expect(requirementsFingerprint([celiac, access])).toBe(
      requirementsFingerprint([access, celiac]),
    );
  });
});

describe("cacheableUnits", () => {
  it("splits a search blob into one unit per card", () => {
    const units = cacheableUnits({ results: [{ name: "A" }, { name: "B" }] });
    expect(units).toHaveLength(2);
    expect(nameOf(units![0])).toBe("A");
  });

  it("treats an enrichment blob as a single unit", () => {
    expect(cacheableUnits({ place: { name: "A", text: "..." } })).toHaveLength(1);
  });

  it("opts the whole call out when a card cannot be named", () => {
    // Unattributable afterwards, so caching any of it would risk storing one
    // card's answer under another card's key.
    expect(
      cacheableUnits({ results: [{ name: "A" }, { text: "no name" }] }),
    ).toBeUndefined();
    expect(cacheableUnits({ results: [] })).toBeUndefined();
    expect(cacheableUnits("not an object")).toBeUndefined();
  });
});

describe("extractFindings with a cache", () => {
  const blob = {
    results: [
      { name: "Cafe A", text: "Restaurant sans gluten" },
      { name: "Cafe B", text: "Boulangerie" },
    ],
  };

  const llmFor = (names: string[]) =>
    new FakeLlmProvider({
      handler: () => ({
        places: names.map((name) => ({
          name,
          evidence: [
            {
              requirementId: "celiac",
              claim: name + " claim",
              polarity: "supports" as const,
              quote: "",
              confidence: 0.9,
            },
          ],
        })),
      }),
    });

  const args = (llm: FakeLlmProvider, cache?: ExtractionCache) => ({
    source: "google_maps",
    sourceUrl: "https://maps.example/search",
    requirements: [celiac],
    uiLocale: "en" as const,
    searchLang,
    llm,
    cache,
    signal: new AbortController().signal,
    log: noopLog,
  });

  it("stores each place under its own key, then serves a re-run with no LLM call", async () => {
    const { cache, puts } = memoryCache();

    const first = await extractFindings(blob, args(llmFor(["Cafe A", "Cafe B"]), cache));
    expect(first.map((f) => f.place.name)).toEqual(["Cafe A", "Cafe B"]);
    expect(puts).toHaveLength(2);

    // A model that would throw if it were called at all.
    const exploding = new FakeLlmProvider({
      handler: () => {
        throw new Error("the model must not be called on a full cache hit");
      },
    });
    const second = await extractFindings(blob, args(exploding, cache));
    expect(second.map((f) => f.place.name)).toEqual(["Cafe A", "Cafe B"]);
  });

  it("asks the model only about the places it does not already know", async () => {
    const { cache } = memoryCache();
    await extractFindings(
      { results: [blob.results[0]!] },
      args(llmFor(["Cafe A"]), cache),
    );

    const seen: string[] = [];
    const llm = new FakeLlmProvider({
      handler: (call: { user: string }) => {
        seen.push(call.user);
        return {
          places: [
            {
              name: "Cafe B",
              evidence: [
                {
                  requirementId: "celiac",
                  claim: "B claim",
                  polarity: "supports" as const,
                  quote: "",
                  confidence: 0.9,
                },
              ],
            },
          ],
        };
      },
    });

    const out = await extractFindings(blob, args(llm, cache));

    expect(seen).toHaveLength(1);
    // The saving is in the PROMPT, not merely in the answer.
    expect(seen[0]).toContain("Cafe B");
    expect(seen[0]).not.toContain("Cafe A");
    expect(out.map((f) => f.place.name).sort()).toEqual(["Cafe A", "Cafe B"]);
  });

  it("refuses to cache two cards that share a name", async () => {
    // Which answer belongs to which card is unknowable, so neither is stored.
    const { cache, puts } = memoryCache();
    await extractFindings(
      {
        results: [
          { name: "Chez Jose", text: "one" },
          { name: "Chez Jose", text: "two" },
        ],
      },
      args(llmFor(["Chez Jose"]), cache),
    );
    expect(puts).toHaveLength(0);
  });

  it("caches a card the model found nothing for, rather than re-asking forever", async () => {
    const { cache, puts } = memoryCache();
    await extractFindings(
      { results: [{ name: "Cafe A", text: "nothing relevant" }] },
      args(new FakeLlmProvider({ handler: () => ({ places: [] }) }), cache),
    );
    expect(puts).toHaveLength(1);
    expect(puts[0]!.findings).toEqual([]);
  });

  it("still returns the cache hits when the call for the rest fails", async () => {
    const { cache } = memoryCache();
    await extractFindings({ results: [blob.results[0]!] }, args(llmFor(["Cafe A"]), cache));

    const failing = new FakeLlmProvider({
      handler: () => {
        throw new Error("upstream down");
      },
    });
    const out = await extractFindings(blob, args(failing, cache));

    expect(out.map((f) => f.place.name)).toEqual(["Cafe A"]);
  });

  it("does nothing at all when no cache is supplied", async () => {
    const out = await extractFindings(blob, args(llmFor(["Cafe A", "Cafe B"])));
    expect(out).toHaveLength(2);
  });
});

describe("createExtractionCache", () => {
  const finding: PlaceFinding = {
    place: { name: "Cafe A", canonicalKey: "cafe-a" },
    source: { source: "google_maps", sourceUrl: "https://maps.example/x" },
    evidence: [
      {
        requirementId: "celiac",
        claim: "entirely gluten-free",
        polarity: "supports",
        quote: "Restaurant sans gluten",
        source: "google_maps",
        sourceUrl: "https://maps.example/x",
        confidence: 0.95,
      },
    ],
  };

  it("is absent — not a no-op object — when the TTL disables it", async () => {
    handle = await makeDb();
    // Absent travels as "do not even compute keys"; a no-op object would look
    // like a working cache that silently never answers.
    expect(
      createExtractionCache({ db: handle.db, ttlHours: 0, source: "google_maps" }),
    ).toBeUndefined();
    expect(
      createExtractionCache({ db: handle.db, ttlHours: -3, source: "google_maps" }),
    ).toBeUndefined();
  });

  it("round-trips a finding through SQLite intact", async () => {
    handle = await makeDb();
    const cache = createExtractionCache({
      db: handle.db,
      ttlHours: 24,
      source: "google_maps",
    })!;

    await cache.put([{ key: "k1", findings: [finding] }]);
    const hit = await cache.get(["k1"]);

    expect(hit.get("k1")).toEqual([finding]);
  });

  it("treats a row it can no longer parse as a miss, not a crash", async () => {
    handle = await makeDb();
    const cache = createExtractionCache({
      db: handle.db,
      ttlHours: 24,
      source: "google_maps",
    })!;
    await cache.put([{ key: "k1", findings: [finding] }]);

    // What a schema change between versions looks like from here.
    await handle.client.execute(
      "UPDATE extraction_cache SET findings_json = '[{\"place\":{}}]' WHERE key = 'k1'",
    );

    await expect(cache.get(["k1"])).resolves.toEqual(new Map());
  });
});
