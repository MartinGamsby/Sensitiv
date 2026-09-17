import { describe, expect, it } from "vitest";
import type { Evidence, PlannedRequirement } from "@sensitiv/shared";
import { toPlannedRequirement } from "@sensitiv/shared/catalog/index";
import { scorePlace, unverifiedRequirements } from "./score.ts";

function ev(over: Partial<Evidence> & { polarity: Evidence["polarity"] }): Evidence {
  return {
    requirementId: "celiac",
    claim: "claim",
    quote: "",
    source: "google_maps",
    sourceUrl: "https://example.com",
    confidence: 0.5,
    ...over,
  };
}

// The two requirements from the run this rubric was rewritten for: a catalog
// chip the user picked (celiac, weight 3) and a preference the planner derived
// from the free text "Italian" (weight 1).
const celiac = toPlannedRequirement("celiac", "en");
const italian: PlannedRequirement = {
  id: "custom_cuisine_italienne",
  label: "Cuisine italienne",
  intentIds: ["dining"],
  must: [],
  nice: [],
  weight: 1,
  satisfiedBy: [],
};
const both = [celiac, italian];

describe("scorePlace rubric", () => {
  it("+2 (weighted) when a source explicitly marks the requirement", () => {
    const s = scorePlace([ev({ polarity: "supports", confidence: 0.9 })], {
      requirements: [celiac],
    });
    expect(s.breakdown.find((l) => l.rule === "explicit")).toBeDefined();
    expect(s.score).toBe(6); // +2 base * weight 3
    expect(s.conflicted).toBe(false);
  });

  it("+1 for a supporting claim below the explicit-mark confidence", () => {
    const s = scorePlace([ev({ polarity: "supports", confidence: 0.5 })], {
      requirements: [celiac],
    });
    expect(s.breakdown.map((l) => l.rule)).toEqual(["supported"]);
    expect(s.score).toBe(3);
  });

  it("adds a corroboration bonus only when a SECOND source agrees", () => {
    const one = scorePlace(
      [
        ev({ polarity: "supports", confidence: 0.5 }),
        ev({ polarity: "supports", confidence: 0.6 }),
      ],
      { requirements: [celiac] },
    );
    expect(one.breakdown.map((l) => l.rule)).toEqual(["supported"]);
    expect(one.score).toBe(3);

    const two = scorePlace(
      [
        ev({ polarity: "supports", confidence: 0.5, source: "google_maps" }),
        ev({ polarity: "supports", confidence: 0.6, source: "yelp" }),
      ],
      { requirements: [celiac] },
    );
    expect(two.breakdown.map((l) => l.rule)).toEqual(["supported", "corroborated"]);
    expect(two.score).toBe(6);
  });

  it("-2 (weighted) when a source contradicts it", () => {
    const s = scorePlace([ev({ polarity: "contradicts" })], { requirements: [celiac] });
    expect(s.breakdown.map((l) => l.rule)).toEqual(["contradicted"]);
    expect(s.score).toBe(-6);
  });

  it("scores `unclear` as 0, never worse than having no evidence at all", () => {
    const unclear = scorePlace([ev({ polarity: "unclear", confidence: 0.5 })], {
      requirements: [celiac],
    });
    const silent = scorePlace([], { requirements: [celiac] });
    expect(unclear.score).toBe(0);
    expect(silent.score).toBe(0);
    expect(unclear.breakdown.map((l) => l.rule)).toEqual(["unverified"]);
  });

  it("emits an `unverified` line for a requirement no source mentioned", () => {
    const s = scorePlace([ev({ polarity: "supports", confidence: 0.9 })], {
      requirements: both,
    });
    const italianLine = s.breakdown.find(
      (l) => l.requirementId === "custom_cuisine_italienne",
    );
    expect(italianLine?.rule).toBe("unverified");
    expect(italianLine?.delta).toBe(0);
  });

  it("never taxes a single-source run (the only source Sensitiv has today)", () => {
    // Every real run has exactly one working adapter, so a rule that fires on
    // `sources.size === 1` is a flat tax rather than a signal.
    const s = scorePlace([ev({ polarity: "supports", confidence: 0.4 })], {
      requirements: [celiac],
    });
    expect(s.score).toBeGreaterThan(0);
  });

  it("conflicted (amber) when one requirement has both polarities; still scored", () => {
    const s = scorePlace(
      [
        ev({ polarity: "supports", confidence: 0.9, source: "google_maps" }),
        ev({ polarity: "contradicts", confidence: 0.6, source: "yelp" }),
      ],
      { requirements: [celiac] },
    );
    expect(s.conflicted).toBe(true);
    expect(s.breakdown.map((l) => l.rule).sort()).toEqual([
      "contradicted",
      "explicit",
    ]);
    expect(s.score).toBe(0);
  });

  it("falls back to the ad-hoc weight for a requirement it was not told about", () => {
    const s = scorePlace([ev({ polarity: "supports", confidence: 0.9 })]);
    expect(s.score).toBe(2);
  });
});

describe("requirement weighting (the celiac-vs-Italian regression)", () => {
  // Job 8150b7c4: a celiac + "Italian" search ranked `Veravin 2.0` — categorised
  // "Restaurant sans gluten" — LAST at -3, below seven wheat-flour restaurants,
  // because a lone celiac support was taxed -1 and "not Italian" cost -2.
  const dedicatedGlutenFree = [
    ev({ requirementId: "celiac", polarity: "supports", confidence: 0.9 }),
    ev({ requirementId: "custom_cuisine_italienne", polarity: "contradicts" }),
  ];
  // A trattoria that is unmistakably Italian and says nothing about gluten.
  const italianButUnverified = [
    ev({ requirementId: "custom_cuisine_italienne", polarity: "supports", confidence: 0.9 }),
    ev({ requirementId: "celiac", polarity: "unclear" }),
  ];

  it("ranks the place that satisfies the safety requirement above the one that does not", () => {
    const gf = scorePlace(dedicatedGlutenFree, { requirements: both });
    const trattoria = scorePlace(italianButUnverified, { requirements: both });
    expect(gf.score).toBeGreaterThan(trattoria.score);
    expect(gf.score).toBeGreaterThan(0);
  });

  it("a contradicted preference cannot outweigh a satisfied safety requirement", () => {
    const gf = scorePlace(dedicatedGlutenFree, { requirements: both });
    expect(gf.score).toBe(6 - 2);
  });
});

describe("unverifiedRequirements", () => {
  it("lists what no source settled, heaviest first", () => {
    const missing = unverifiedRequirements(
      [ev({ requirementId: "custom_cuisine_italienne", polarity: "supports" })],
      both,
    );
    expect(missing.map((r) => r.id)).toEqual(["celiac"]);
  });

  it("treats `unclear` as unsettled — that is the whole point of opening the page", () => {
    const missing = unverifiedRequirements([ev({ polarity: "unclear" })], [celiac]);
    expect(missing.map((r) => r.id)).toEqual(["celiac"]);
  });

  it("drops a requirement a source settled either way", () => {
    expect(unverifiedRequirements([ev({ polarity: "supports" })], [celiac])).toEqual([]);
    expect(unverifiedRequirements([ev({ polarity: "contradicts" })], [celiac])).toEqual([]);
  });

  it("orders a heavy requirement before a light one", () => {
    const missing = unverifiedRequirements([], both);
    expect(missing.map((r) => r.id)).toEqual(["celiac", "custom_cuisine_italienne"]);
  });
});
