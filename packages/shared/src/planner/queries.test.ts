import { describe, expect, it } from "vitest";
import {
  DEFAULT_REQUIREMENT_WEIGHT,
  toPlannedRequirement,
} from "../../catalog/index.ts";
import { LocationSchema } from "../schema/location.ts";
import { buildSearchQueries, locationPhrase } from "./queries.ts";

const autoFr = { code: "fr", source: "auto" } as const;
const autoEn = { code: "en", source: "auto" } as const;

describe("locationPhrase", () => {
  it("appends the postal code when present", () => {
    const loc = LocationSchema.parse({ query: "Rosemont", postalCode: "H1X 2B3" });
    expect(locationPhrase(loc)).toContain("H1X2B3");
  });

  it("omits the postal code when absent", () => {
    const loc = LocationSchema.parse({ query: "Rosemont" });
    expect(locationPhrase(loc)).toBe("Rosemont");
  });

  it("does not duplicate a city already inside the query", () => {
    const loc = LocationSchema.parse({
      query: "Rosemont, Montreal",
      city: "Montreal",
      region: "Quebec",
    });
    const phrase = locationPhrase(loc);
    expect(phrase.match(/Montreal/g)).toHaveLength(1);
    // region is not in the query, so it is added
    expect(phrase).toContain("Quebec");
  });

  it("does not duplicate a city that differs from the query only by accent", () => {
    const loc = LocationSchema.parse({
      query: "Montréal",
      city: "Montreal",
    });
    const phrase = locationPhrase(loc);
    expect(phrase.match(/Montr[ée]al/gi)).toHaveLength(1);
  });
});

describe("buildSearchQueries", () => {
  const plateau = LocationSchema.parse({
    query: "Plateau-Mont-Royal, Montreal",
    city: "Montreal",
    region: "Quebec",
    country: "CA",
    postalCode: "H2T",
  });

  it("emits (adapter, intent, query) triples in the search language", () => {
    const queries = buildSearchQueries({
      intentIds: ["dining", "grocery"],
      requirements: [toPlannedRequirement("celiac", "en")],
      location: plateau,
      searchLang: autoFr,
    });

    expect(queries.length).toBeGreaterThan(0);
    for (const q of queries) {
      expect(typeof q.adapterId).toBe("string");
      expect(["dining", "grocery"]).toContain(q.intentId);
      expect(q.query).toContain("sans gluten");
      expect(q.query).toContain("H2T");
    }
    // google_maps serves both intents
    expect(queries.some((q) => q.adapterId === "google_maps" && q.intentId === "dining")).toBe(
      true,
    );
  });

  it("uses English terms when the search language is English", () => {
    const queries = buildSearchQueries({
      intentIds: ["dining"],
      requirements: [toPlannedRequirement("celiac", "en")],
      location: plateau,
      searchLang: autoEn,
    });
    expect(queries[0]?.query).toContain("gluten free");
    expect(queries[0]?.query).toContain("restaurant");
  });

  it("falls back to the requirement's own label for a custom requirement", () => {
    const queries = buildSearchQueries({
      intentIds: ["services"],
      requirements: [
        {
          id: "custom_quiet_street",
          label: "rue tranquille",
          intentIds: ["services"],
          must: [],
          nice: [],
          weight: DEFAULT_REQUIREMENT_WEIGHT,
          satisfiedBy: [],
        },
      ],
      location: plateau,
      searchLang: autoFr,
    });
    // Position moved when requirements started combining into one query
    // (ad-hoc terms trail the intent term now); what this test is about is that
    // the label is used at all.
    expect(queries.every((q) => q.query.includes("rue tranquille"))).toBe(true);
  });

  it("skips intent ids that are not in the catalog", () => {
    const queries = buildSearchQueries({
      intentIds: ["dining", "restaurants"],
      requirements: [toPlannedRequirement("celiac", "en")],
      location: plateau,
      searchLang: autoFr,
    });
    expect(queries.every((q) => q.intentId === "dining")).toBe(true);
  });

  it("does not double the intent term when a custom requirement label already carries it", () => {
    const queries = buildSearchQueries({
      intentIds: ["dining"],
      requirements: [
        {
          id: "custom_mexican",
          label: "Mexican restaurant",
          intentIds: ["dining"],
          must: [],
          nice: [],
          weight: DEFAULT_REQUIREMENT_WEIGHT,
          satisfiedBy: [],
        },
      ],
      location: plateau,
      searchLang: autoEn,
    });
    const googleMaps = queries.find((q) => q.adapterId === "google_maps");
    expect(googleMaps?.query).toBe("Mexican restaurant Plateau-Mont-Royal, Montreal H2T Quebec");
    for (const q of queries) {
      expect(q.query).not.toContain("restaurant restaurant");
    }
  });

  it("still composes catalog requirement + intent term normally (no regression)", () => {
    const queries = buildSearchQueries({
      intentIds: ["dining"],
      requirements: [toPlannedRequirement("celiac", "en")],
      location: plateau,
      searchLang: autoEn,
    });
    const googleMaps = queries.find((q) => q.adapterId === "google_maps");
    expect(googleMaps?.query.startsWith("gluten free restaurant")).toBe(true);
  });

  it("does not double an intent term already inside a custom requirement label, in French", () => {
    const queries = buildSearchQueries({
      intentIds: ["grocery"],
      requirements: [
        {
          id: "custom_epicerie",
          label: "épicerie sans gluten",
          intentIds: ["grocery"],
          must: [],
          nice: [],
          weight: DEFAULT_REQUIREMENT_WEIGHT,
          satisfiedBy: [],
        },
      ],
      location: plateau,
      searchLang: autoFr,
    });
    for (const q of queries) {
      expect(q.query.match(/[ée]picerie/gi)).toHaveLength(1);
    }
  });

  it("keeps the intent term when the custom requirement label does not contain it as a whole word", () => {
    const queries = buildSearchQueries({
      intentIds: ["dining"],
      requirements: [
        {
          id: "custom_barbecue",
          label: "barbecue",
          intentIds: ["dining"],
          must: [],
          nice: [],
          weight: DEFAULT_REQUIREMENT_WEIGHT,
          satisfiedBy: [],
        },
      ],
      location: plateau,
      searchLang: autoEn,
    });
    for (const q of queries) {
      expect(q.query).toContain("restaurant");
    }
  });
});

describe("one query carries every requirement", () => {
  const plateau = LocationSchema.parse({
    query: "Plateau-Mont-Royal, Montreal",
    city: "Montreal",
    region: "Quebec",
    country: "CA",
    postalCode: "H2T",
  });
  const celiacPlusItalian = [
    toPlannedRequirement("celiac", "en"),
    {
      id: "custom_cuisine_italienne",
      label: "Cuisine italienne",
      intentIds: ["dining"],
      must: [],
      nice: [],
      weight: DEFAULT_REQUIREMENT_WEIGHT,
      satisfiedBy: [],
    },
  ];

  it("combines the constraints instead of searching for each in isolation", () => {
    // Searching "sans gluten restaurant" on its own asks Google for gluten-free
    // ANYTHING — bakeries, cafes, grocers — when the user asked for an Italian
    // restaurant that happens to be gluten-free.
    const queries = buildSearchQueries({
      intentIds: ["dining"],
      requirements: celiacPlusItalian,
      location: plateau,
      searchLang: autoFr,
    });

    // One row per (intent, adapter) as before, but all carrying the SAME single
    // query text — previously there were two distinct texts per adapter.
    const dining = queries.filter((q) => q.intentId === "dining");
    expect(new Set(dining.map((q) => q.subject)).size).toBe(1);
    expect(dining[0]!.subject).toBe("sans gluten restaurant Cuisine italienne");
  });

  it("puts catalog terms before the noun and ad-hoc terms after it", () => {
    // "sans gluten" is adjectival and reads before "restaurant"; a cuisine
    // reads after it.
    const [query] = buildSearchQueries({
      intentIds: ["dining"],
      requirements: celiacPlusItalian,
      location: plateau,
      searchLang: autoFr,
    });
    const subject = query!.subject;
    expect(subject.indexOf("sans gluten")).toBeLessThan(subject.indexOf("restaurant"));
    expect(subject.indexOf("restaurant")).toBeLessThan(subject.indexOf("Cuisine italienne"));
  });

  it("halves the searches, which halves the page loads", () => {
    const before = buildSearchQueries({
      intentIds: ["dining"],
      requirements: celiacPlusItalian,
      location: plateau,
      searchLang: autoFr,
    });
    // What the adapter actually pays for is distinct query TEXTS, one page load
    // each; it used to be handed two.
    expect(
      new Set(
        before.filter((q) => q.adapterId === "google_maps").map((q) => q.query),
      ).size,
    ).toBe(1);
  });

  it("still drops a doubled intent term when an ad-hoc label carries it", () => {
    const queries = buildSearchQueries({
      intentIds: ["dining"],
      requirements: [
        toPlannedRequirement("celiac", "en"),
        {
          id: "custom_mexican_restaurant",
          label: "Mexican restaurant",
          intentIds: ["dining"],
          must: [],
          nice: [],
          weight: DEFAULT_REQUIREMENT_WEIGHT,
          satisfiedBy: [],
        },
      ],
      location: plateau,
      searchLang: autoEn,
    });

    expect(queries[0]!.subject).toBe("gluten free Mexican restaurant");
  });

  it("is unchanged for a single catalog requirement", () => {
    const queries = buildSearchQueries({
      intentIds: ["dining"],
      requirements: [toPlannedRequirement("celiac", "en")],
      location: plateau,
      searchLang: autoEn,
    });
    expect(queries[0]!.subject).toBe("gluten free restaurant");
  });
});
