import { describe, expect, it } from "vitest";
import type { Evidence, PlannedRequirement } from "@sensitiv/shared";
import { toPlannedRequirement } from "@sensitiv/shared/catalog/index";
import {
  PROXIMITY_MAX,
  proximityScore,
  scorePlace,
  unverifiedRequirements,
} from "./score.ts";

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
    // (1 + confidence) * weight — continuous, so 0.9 and 0.95 differ.
    expect(s.score).toBe(5.7);
    expect(s.conflicted).toBe(false);
  });

  it("+1 for a supporting claim below the explicit-mark confidence", () => {
    const s = scorePlace([ev({ polarity: "supports", confidence: 0.5 })], {
      requirements: [celiac],
    });
    expect(s.breakdown.map((l) => l.rule)).toEqual(["supported"]);
    expect(s.score).toBe(4.5);
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
    expect(one.score).toBe(4.8); // best supporting confidence is 0.6

    const two = scorePlace(
      [
        ev({ polarity: "supports", confidence: 0.5, source: "google_maps" }),
        ev({ polarity: "supports", confidence: 0.6, source: "yelp" }),
      ],
      { requirements: [celiac] },
    );
    expect(two.breakdown.map((l) => l.rule)).toEqual(["supported", "corroborated"]);
    expect(two.score).toBe(6.3); // 4.8 + a 0.5 * weight corroboration bonus
  });

  it("-2 (weighted) when a source contradicts it", () => {
    const s = scorePlace([ev({ polarity: "contradicts" })], { requirements: [celiac] });
    expect(s.breakdown.map((l) => l.rule)).toEqual(["contradicted"]);
    expect(s.score).toBe(-4.5);
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
    expect(s.score).toBe(0.9); // 1.9*3 supporting, -1.6*3 contradicting
  });

  it("falls back to the ad-hoc weight for a requirement it was not told about", () => {
    const s = scorePlace([ev({ polarity: "supports", confidence: 0.9 })]);
    expect(s.score).toBe(1.9);
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
    // celiac supports @0.9 -> 1.9*3; "not Italian" @0.5 -> -1.5*1.
    expect(gf.score).toBe(5.7 - 1.5);
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

describe("proximity — distance from where the search was actually centred", () => {
  // The H1S run: a 5 km search returned four top-scoring places 5–7 km out,
  // while the one the user wanted sat 1.8 km away and ranked fifth.
  const center = { lat: 45.582, lng: -73.5829 };
  const near = { lat: 45.5957, lng: -73.5709 }; // Ottavio, ~1.8 km
  const far = { lat: 45.5167, lng: -73.5739 }; // ~7.3 km

  it("rewards the centre and penalises past the radius", () => {
    expect(proximityScore(0, 5)).toBe(PROXIMITY_MAX);
    expect(proximityScore(5, 5)).toBe(0);
    expect(proximityScore(10, 5)).toBe(-PROXIMITY_MAX);
    // Clamped, not unbounded: 40 km away is not forty times worse than 10.
    expect(proximityScore(40, 5)).toBe(-PROXIMITY_MAX);
  });

  it("is neutral when there is nothing to measure", () => {
    expect(proximityScore(Number.NaN, 5)).toBe(0);
    expect(proximityScore(3, 0)).toBe(0);
    // A place with no coordinates is not penalised for it.
    const s = scorePlace([ev({ polarity: "supports", confidence: 0.9 })], {
      requirements: [celiac],
      center,
      radiusKm: 5,
      place: {},
    });
    expect(s.breakdown.some((l) => l.rule === "proximity")).toBe(false);
  });

  it("lifts a nearby place over a better-matching distant one", () => {
    const ottavio = scorePlace(
      [ev({ requirementId: "celiac", polarity: "supports", confidence: 0.6 })],
      { requirements: both, center, radiusKm: 5, place: near },
    );
    const distantBakery = scorePlace(
      [ev({ requirementId: "celiac", polarity: "supports", confidence: 0.9 })],
      { requirements: both, center, radiusKm: 5, place: far },
    );
    expect(ottavio.score).toBeGreaterThan(distantBakery.score);
  });

  it("cannot overturn a safety requirement on its own", () => {
    // Being next door does not make a place that CONTRADICTS celiac outrank one
    // that satisfies it 7 km away. That ceiling is the whole reason the term is
    // bounded at ±2.
    const nextDoorButUnsafe = scorePlace(
      [ev({ requirementId: "celiac", polarity: "contradicts", confidence: 0.9 })],
      { requirements: both, center, radiusKm: 5, place: center },
    );
    const farButSafe = scorePlace(
      [ev({ requirementId: "celiac", polarity: "supports", confidence: 0.9 })],
      { requirements: both, center, radiusKm: 5, place: far },
    );
    expect(farButSafe.score).toBeGreaterThan(nextDoorButUnsafe.score);
  });

  it("counts the distance once, not once per requirement", () => {
    const s = scorePlace(
      [
        ev({ requirementId: "celiac", polarity: "supports", confidence: 0.9 }),
        ev({ requirementId: "custom_cuisine_italienne", polarity: "supports", confidence: 0.9 }),
      ],
      { requirements: both, center, radiusKm: 5, place: near },
    );
    expect(s.breakdown.filter((l) => l.rule === "proximity")).toHaveLength(1);
  });
});
