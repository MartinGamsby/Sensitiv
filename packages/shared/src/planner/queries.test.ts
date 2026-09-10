import { describe, expect, it } from "vitest";
import { toPlannedRequirement } from "../../catalog/index.ts";
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
        },
      ],
      location: plateau,
      searchLang: autoFr,
    });
    expect(queries.every((q) => q.query.startsWith("rue tranquille"))).toBe(true);
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
});
