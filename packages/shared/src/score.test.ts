import { describe, expect, it } from "vitest";
import { maxAchievableScore, scorePercent } from "./schema/score.ts";
import type { Evidence } from "./schema/evidence.ts";
import type { PlannedRequirement } from "./schema/requirement.ts";
import { toPlannedRequirement } from "../catalog/index.ts";
import {
  PROXIMITY_MAX,
  bestCaseScore,
  proximityScore,
  scorePlace,
  searchCutoffKm,
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
    // MAX_SUPPORT_BASE * confidence * weight — proportional, no floor, so 0.9
    // and 0.95 differ and a near-zero confidence is worth near-zero.
    expect(s.score).toBe(10.8);
    expect(s.conflicted).toBe(false);
  });

  it("+1 for a supporting claim below the explicit-mark confidence", () => {
    const s = scorePlace([ev({ polarity: "supports", confidence: 0.5 })], {
      requirements: [celiac],
    });
    expect(s.breakdown.map((l) => l.rule)).toEqual(["supported"]);
    expect(s.score).toBe(6); // 2 * 0.5 * 6
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
    expect(one.score).toBe(7.2); // best supporting confidence is 0.6

    const two = scorePlace(
      [
        ev({ polarity: "supports", confidence: 0.5, source: "google_maps" }),
        ev({ polarity: "supports", confidence: 0.6, source: "yelp" }),
      ],
      { requirements: [celiac] },
    );
    expect(two.breakdown.map((l) => l.rule)).toEqual(["supported", "corroborated"]);
    // `yelp` is not in SOURCE_RELIABILITY, so it is worth the default 0.7 —
    // both in the support it offers (0.6 * 0.7 = 0.42, below google_maps' own
    // 0.5, so `bestSupport` stays 0.5) and in the corroboration it adds
    // (0.5 * 0.7 * weight). Agreement from a source we have not assessed is
    // worth having; it is not worth as much as agreement from one we have.
    expect(two.score).toBe(8.1); // 2 * 0.5 * 6 + 0.5 * 0.7 * 6
  });

  it("-2 (weighted) when a source contradicts it", () => {
    const s = scorePlace([ev({ polarity: "contradicts" })], { requirements: [celiac] });
    expect(s.breakdown.map((l) => l.rule)).toEqual(["contradicted"]);
    expect(s.score).toBe(-9);
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
    expect(s.score).toBe(1.2); // 2*0.9*6 supporting, -(1+0.6)*6 contradicting
  });

  it("falls back to the ad-hoc weight for a requirement it was not told about", () => {
    const s = scorePlace([ev({ polarity: "supports", confidence: 0.9 })]);
    expect(s.score).toBe(1.8); // 2 * 0.9 * DEFAULT_REQUIREMENT_WEIGHT
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
    // celiac supports @0.9 -> 2*0.9*6; "not Italian" @0.5 -> -(1+0.5)*1.
    expect(gf.score).toBe(10.8 - 1.5);
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

describe("searchCutoffKm — how far out a place is still worth reading", () => {
  it("is the radius plus half again", () => {
    expect(searchCutoffKm(3)).toBe(4.5);
    expect(searchCutoffKm(20)).toBe(30);
  });

  it("never reaches more than 10 km past the radius", () => {
    expect(searchCutoffKm(100)).toBe(110);
    expect(searchCutoffKm(40)).toBe(50);
  });
});

describe("bestCaseScore — the ceiling that lets an adapter skip a page", () => {
  const opts = { requirements: both, place: { category: "Bakery" } };
  const starts: Evidence[][] = [
    [],
    [ev({ polarity: "unclear" })],
    [ev({ polarity: "supports", confidence: 0.6 })],
    [ev({ polarity: "contradicts", confidence: 0.9 })],
    [ev({ requirementId: "custom_cuisine_italienne", polarity: "contradicts", confidence: 0.4 })],
  ];
  // Every single claim a Maps page could add, on every planned requirement.
  const outcomes: Evidence[] = both.flatMap((r) =>
    [0, 0.3, 0.8, 1].flatMap((confidence) =>
      (["supports", "contradicts", "unclear"] as const).map((polarity) =>
        ev({ requirementId: r.id, polarity, confidence }),
      ),
    ),
  );

  it("is never beaten by any mix of claims the page could add", () => {
    for (const start of starts) {
      const ceiling = bestCaseScore(start, opts, "google_maps");
      for (const a of outcomes) {
        for (const b of outcomes) {
          const reached = scorePlace([...start, a, b], opts).score;
          expect(reached).toBeLessThanOrEqual(ceiling);
        }
      }
    }
  });

  it("is reached exactly when the page confirms everything", () => {
    const confirmed = both.map((r) =>
      ev({ requirementId: r.id, polarity: "supports", confidence: 1 }),
    );
    expect(scorePlace(confirmed, opts).score).toBe(bestCaseScore([], opts, "google_maps"));
  });

  it("keeps a contradiction already on file, so it is lower for that place", () => {
    const clean = bestCaseScore([], opts, "google_maps");
    const contradicted = bestCaseScore(
      [ev({ polarity: "contradicts", confidence: 0.9 })],
      opts,
      "google_maps",
    );
    expect(contradicted).toBeLessThan(clean);
    // -(1 + 0.9) at the celiac weight is exactly what it costs.
    expect(clean - contradicted).toBeCloseTo(1.9 * celiac.weight, 5);
  });

  it("counts the corroboration a new source would add", () => {
    const osmOnly = [ev({ polarity: "supports", confidence: 1, source: "openstreetmap" })];
    expect(bestCaseScore(osmOnly, opts, "google_maps")).toBeGreaterThan(
      bestCaseScore(osmOnly, opts, "openstreetmap"),
    );
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

  it("lifts a nearby place over an equally good distant one", () => {
    // What the ±2 bound promises: it reorders places the requirements score
    // ALIKE, and little else. Same evidence, different distance.
    const ottavio = scorePlace(
      [ev({ requirementId: "celiac", polarity: "supports", confidence: 0.6 })],
      { requirements: both, center, radiusKm: 5, place: near },
    );
    const distantTwin = scorePlace(
      [ev({ requirementId: "celiac", polarity: "supports", confidence: 0.6 })],
      { requirements: both, center, radiusKm: 5, place: far },
    );
    expect(ottavio.score).toBeGreaterThan(distantTwin.score);
  });

  it("cannot overturn a real difference in how well a source settled it", () => {
    // Being 5.5 km closer does not beat a source that is half again as
    // confident, now that support is proportional rather than a flat +1 with a
    // confidence modifier on top. `0.6 -> 0.9` is worth 3.6 at celiac's weight;
    // the whole proximity term swings 4.
    const nearButWeaker = scorePlace(
      [ev({ requirementId: "celiac", polarity: "supports", confidence: 0.6 })],
      { requirements: both, center, radiusKm: 5, place: near },
    );
    const farButStronger = scorePlace(
      [ev({ requirementId: "celiac", polarity: "supports", confidence: 0.9 })],
      { requirements: both, center, radiusKm: 5, place: far },
    );
    expect(farButStronger.score).toBeGreaterThan(nearButWeaker.score);
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

// The dossier shows a score as a percentage of `maxAchievableScore`, so that
// ceiling has to actually BE the ceiling. If the rubric ever grows a rule the
// shared constant does not account for, a perfect place quietly starts
// reporting more than 100% — clamped to 100, so nothing would look broken and
// the ranking's top would silently flatten. These are the tests that notice.
describe("the rubric stays inside the ceiling the dossier divides by", () => {
  const center = { lat: 45.52, lng: -73.58 };

  it("reaches the advertised maximum only with two fully-trusted sources", () => {
    // The ceiling is what a COMPLETE answer looks like, and corroboration by a
    // community map is not the same completeness as corroboration by two
    // sources we take at face value. Sensitiv has exactly one of those today,
    // so 100% is currently out of reach — which is the honest reading of a run
    // that could not fully corroborate anything, and the same reason a
    // single-source run never reached it either.
    const both_ = both;
    const max = maxAchievableScore(both_, { withProximity: true });

    const realWorld = scorePlace(
      [
        ev({ requirementId: "celiac", polarity: "supports", confidence: 1, source: "google_maps" }),
        ev({ requirementId: "celiac", polarity: "supports", confidence: 1, source: "openstreetmap" }),
        ev({ requirementId: "custom_cuisine_italienne", polarity: "supports", confidence: 1, source: "google_maps" }),
        ev({ requirementId: "custom_cuisine_italienne", polarity: "supports", confidence: 1, source: "openstreetmap" }),
      ],
      { requirements: both_, center, radiusKm: 5, place: center },
    );
    // Every requirement maxed on support, corroborated by OpenStreetMap at 0.7.
    expect(realWorld.score).toBeLessThan(max);
    expect(scorePercent(realWorld.score, max)).toBe(95);

    // Two sources at full reliability DO reach it. `google_maps` is the only
    // one today, so this pairs it with a second listing-grade id to show the
    // ceiling is reachable in principle rather than a number nothing can hit.
    const perfect = scorePlace(
      both_.flatMap((r) => [
        ev({ requirementId: r.id, polarity: "supports", confidence: 1, source: "google_maps" }),
        ev({ requirementId: r.id, polarity: "supports", confidence: 1, source: "trusted_partner" }),
        ev({ requirementId: r.id, polarity: "supports", confidence: 1, source: "third_listing" }),
      ]),
      { requirements: both_, center, radiusKm: 5, place: center },
    );
    // 1 + 0.7 + 0.7 = 2.4, clamped to 1 -> the full corroboration bonus.
    expect(perfect.score).toBe(max);
    expect(scorePercent(perfect.score, max)).toBe(100);
  });

  it("no combination of evidence gets above it", () => {
    const max = maxAchievableScore(both, { withProximity: true });
    const polarities: Evidence["polarity"][] = ["supports", "contradicts", "unclear"];
    for (const polarity of polarities) {
      for (const confidence of [0, 0.5, 0.8, 1]) {
        const s = scorePlace(
          both.flatMap((r) =>
            ["google_maps", "openstreetmap", "yelp"].map((source) =>
              ev({ requirementId: r.id, polarity, confidence, source }),
            ),
          ),
          { requirements: both, center, radiusKm: 5, place: center },
        );
        expect(s.score).toBeLessThanOrEqual(max);
      }
    }
  });

  it("a run with a centre it never resolved still fits its own ceiling", () => {
    const s = scorePlace(
      [ev({ requirementId: "celiac", polarity: "supports", confidence: 1 })],
      { requirements: both },
    );
    expect(s.score).toBeLessThanOrEqual(
      maxAchievableScore(both, { withProximity: false }),
    );
  });
});

// ---------------------------------------------------------------------------
// The subject of the search, reconstructed from the run that motivated it:
// job 10eb6fa2, "Mexican restaurant" + the celiac chip, 1 km around
// Ville-Marie. The celiac evidence and the distances below are the real ones.
// ---------------------------------------------------------------------------

const mexican: PlannedRequirement = {
  id: "custom_mexican_restaurant",
  label: "Mexican restaurant",
  intentIds: ["dining"],
  must: [],
  nice: [],
  // SUBJECT_REQUIREMENT_WEIGHT, and the reason this test exists.
  weight: 3,
  satisfiedBy: [],
  kind: "subject",
};

const centre = { lat: 45.5083, lng: -73.5661 };

describe("scorePlace — the kind of place asked for is not a tiebreaker", () => {
  it("ranks a gluten-free Mexican restaurant above a gluten-free pastry shop", () => {
    // Cookie Stéfanie: a dedicated gluten-free PASTRY shop 0.8 km out. Nothing
    // settled "is it Mexican" either way.
    const pastryShop = scorePlace(
      [ev({ requirementId: "celiac", polarity: "supports", confidence: 0.95 })],
      {
        requirements: [celiac, mexican],
        center: centre,
        radiusKm: 1,
        place: { lat: 45.5155, lng: -73.5661 },
      },
    );
    // Tacos Tin Tan: gluten-free evidence at 0.6, explicitly Mexican, and
    // FARTHER away (1.3 km, outside the 1 km radius, so proximity is negative).
    const mexicanRestaurant = scorePlace(
      [
        ev({ requirementId: "celiac", polarity: "supports", confidence: 0.6 }),
        ev({
          requirementId: "custom_mexican_restaurant",
          polarity: "supports",
          confidence: 0.9,
        }),
      ],
      {
        requirements: [celiac, mexican],
        center: centre,
        radiusKm: 1,
        place: { lat: 45.5200, lng: -73.5661 },
      },
    );

    expect(mexicanRestaurant.score).toBeGreaterThan(pastryShop.score);
    // Not by a hair, either: under the old rubric the pastry shop won 6.21 to
    // 6.00 on proximity alone. It now loses 12 to 10.3 despite being nearer and
    // having the stronger celiac claim, because it is not a Mexican restaurant.
    expect(mexicanRestaurant.score - pastryShop.score).toBeGreaterThan(1.5);
  });

  it("an unsettled subject costs -0.5 x weight; an unsettled preference is free", () => {
    const asSubject = scorePlace([], { requirements: [mexican] });
    expect(asSubject.breakdown.map((l) => l.rule)).toEqual(["unverified"]);
    expect(asSubject.score).toBe(-1.5);

    // Same requirement, same weight, only `kind` differs — so this is the one
    // line that proves the rule keys off `kind` and not off the weight.
    const asPreference = scorePlace([], {
      requirements: [{ ...mexican, kind: "preference" }],
    });
    expect(asPreference.score).toBe(0);
  });

  it("a requirement with no `kind` at all reads as a preference", () => {
    // Job rows written before `kind` existed must re-score exactly as they did.
    const legacy: PlannedRequirement = { ...mexican };
    delete legacy.kind;
    expect(scorePlace([], { requirements: [legacy] }).score).toBe(0);
  });

  it("an unanswered safety question outranks a confirmed cuisine", () => {
    // Job 34d414fb, and the reason the chips weigh six rather than three.
    // `Escondite` is explicitly a Mexican restaurant with NOTHING said about
    // gluten; `Arepera` is not Mexican but a source says it is celiac-safe. On
    // a celiac search the second one is the answer, and at equal weights the
    // first one won.
    const escondite = scorePlace(
      [
        ev({
          requirementId: "custom_mexican_restaurant",
          polarity: "supports",
          confidence: 0.9,
        }),
      ],
      { requirements: [celiac, mexican] },
    );
    const arepera = scorePlace(
      [ev({ requirementId: "celiac", polarity: "supports", confidence: 0.6 })],
      { requirements: [celiac, mexican] },
    );

    expect(escondite.score).toBe(5.4); // 0 celiac, +5.4 Mexican
    expect(arepera.score).toBe(5.7); // +7.2 celiac, -1.5 Mexican
    expect(arepera.score).toBeGreaterThan(escondite.score);
  });

  it("a confirmed subject still loses to a contradicted safety requirement", () => {
    // The subject is weighted like a chip, not above one: a place that IS a
    // Mexican restaurant but whose celiac requirement is contradicted must not
    // outrank one where nothing is contradicted. Safety is still the ceiling.
    const glutenyMexican = scorePlace(
      [
        ev({ requirementId: "celiac", polarity: "contradicts", confidence: 0.9 }),
        ev({
          requirementId: "custom_mexican_restaurant",
          polarity: "supports",
          confidence: 0.95,
        }),
      ],
      { requirements: [celiac, mexican] },
    );
    const safeButUnsure = scorePlace(
      [ev({ requirementId: "celiac", polarity: "supports", confidence: 0.9 })],
      { requirements: [celiac, mexican] },
    );
    expect(safeButUnsure.score).toBeGreaterThan(glutenyMexican.score);
  });
});

// ---------------------------------------------------------------------------
// The place's own category, which every adapter records and nothing used to
// read. All three fixtures below are real rows from job 34d414fb.
// ---------------------------------------------------------------------------

const mexicanWithHints: PlannedRequirement = {
  ...mexican,
  categoryHints: {
    strong: ["mexican", "taqueria", "tex mex"],
    related: ["venezuelan", "arepa", "latin american", "peruvian"],
    excluded: ["dessert", "chocolate", "crepe", "bakery", "ice cream"],
  },
};

/** Score one place by its category alone, with no evidence at all. */
function byCategory(category: string, requirement = mexicanWithHints): number {
  return scorePlace([], { requirements: [requirement], place: { category } }).score;
}

describe("scorePlace — a place's category answers what the sources did not", () => {
  it("grades a category instead of treating everything unconfirmed alike", () => {
    // The ordering the whole feature exists for. A dessert shop and a
    // Venezuelan restaurant both fail to be a Mexican restaurant, and they do
    // not fail equally: one is a different kind of establishment, the other is
    // an adjacent cuisine.
    const mexicanPlace = byCategory("Mexican restaurant");
    const venezuelan = byCategory("arepa;venezuelan"); // Arepera
    const unknown = byCategory("");
    const dessert = byCategory("chocolate;crepe;dessert"); // Juliette & Chocolat

    expect(mexicanPlace).toBe(4.5); // 2 * 0.75 * 3
    expect(venezuelan).toBe(0);
    expect(unknown).toBe(-1.5); // -0.5 * 3
    expect(dessert).toBe(-3); // -1 * 3

    expect(mexicanPlace).toBeGreaterThan(venezuelan);
    expect(venezuelan).toBeGreaterThan(unknown);
    expect(unknown).toBeGreaterThan(dessert);
  });

  it("settles a subject from the category with NO hints at all", () => {
    // `3 Amigos` carries the OpenStreetMap category `mexican` and scored zero
    // on "Mexican restaurant", because the OSM adapter only emits evidence for
    // catalog requirements it holds a tag map for. The requirement's own label
    // is enough, with no planner hints and no LLM in the loop.
    expect(byCategory("mexican", mexican)).toBe(4.5);
    expect(
      scorePlace([], {
        requirements: [mexican],
        place: { category: "mexican" },
      }).breakdown.map((l) => l.rule),
    ).toEqual(["supported"]);
  });

  it("does not match on the generic half of a label", () => {
    // "Mexican restaurant" must match a category on `mexican`, never on
    // `restaurant` — that would call every restaurant in the city a match.
    expect(byCategory("Thai restaurant", mexican)).toBe(-1.5);
    expect(byCategory("Pizza restaurant", mexican)).toBe(-1.5);
  });

  it("matches whole words, so `bar` never matches inside `barbecue`", () => {
    const bar: PlannedRequirement = {
      ...mexican,
      id: "custom_wine_bar",
      label: "Wine bar",
      categoryHints: { strong: ["wine bar"], related: [], excluded: [] },
    };
    expect(byCategory("barbecue", bar)).toBe(-1.5);
    expect(byCategory("wine bar;tapas", bar)).toBe(4.5);
  });

  it("ignores accents and separators", () => {
    const cafe: PlannedRequirement = {
      ...mexican,
      id: "custom_cafe",
      label: "Café",
      categoryHints: { strong: ["cafe"], related: [], excluded: [] },
    };
    expect(byCategory("Café / Bistro", cafe)).toBe(4.5);
  });

  it("counts a place that is both — strongest grade wins", () => {
    // `mexican;dessert` is a Mexican restaurant that also does dessert, not a
    // dessert shop, and `excluded` beats `related` for the mirror-image reason.
    expect(byCategory("mexican;dessert")).toBe(4.5);
    expect(byCategory("venezuelan;dessert")).toBe(-3);
  });

  it("leaves a real source's claim stronger than a category field", () => {
    // A source saying in words "this is a Mexican restaurant" outranks a
    // taxonomy field that happens to carry the token, and the credit is not
    // collected twice.
    const quoted = scorePlace(
      [
        ev({
          requirementId: "custom_mexican_restaurant",
          polarity: "supports",
          confidence: 0.95,
        }),
      ],
      { requirements: [mexicanWithHints], place: { category: "Mexican restaurant" } },
    );
    expect(quoted.score).toBe(5.7); // 2 * 0.95 * 3, not 5.7 + 4.5
    expect(quoted.breakdown.map((l) => l.rule)).toEqual(["explicit"]);
  });

  it("never grades a preference by its category", () => {
    // Only a `kind: "subject"` names a kind of place. "Open late" is not a
    // category, and a place whose category happens to contain the word must
    // not be scored as though a source had confirmed it.
    const preference: PlannedRequirement = { ...mexicanWithHints, kind: "preference" };
    expect(byCategory("Mexican restaurant", preference)).toBe(0);
    expect(byCategory("chocolate;crepe;dessert", preference)).toBe(0);
  });

  it("does not let a category overrule a source that contradicts", () => {
    const contradicted = scorePlace(
      [
        ev({
          requirementId: "custom_mexican_restaurant",
          polarity: "contradicts",
          confidence: 0.8,
        }),
      ],
      { requirements: [mexicanWithHints], place: { category: "chocolate;dessert" } },
    );
    // -(1 + 0.8) * 3 from the source, and no extra -3 piled on top.
    expect(contradicted.score).toBe(-5.4);
    expect(contradicted.breakdown.map((l) => l.rule)).toEqual(["contradicted"]);
  });
});

// ---------------------------------------------------------------------------
// Where a claim came from. `diet:gluten_free=yes` on OpenStreetMap is a tag
// anyone may have typed, with no review and no provenance; a Google listing is
// the venue describing itself. Scoring them alike let one unverified tag carry
// a place to the top of a dossier about someone's coeliac disease.
// ---------------------------------------------------------------------------

describe("scorePlace — a source is worth what it is worth", () => {
  it("discounts a community-mapped claim below the same claim from a listing", () => {
    const listing = scorePlace(
      [ev({ polarity: "supports", confidence: 0.6, source: "google_maps" })],
      { requirements: [celiac] },
    );
    const osm = scorePlace(
      [ev({ polarity: "supports", confidence: 0.6, source: "openstreetmap" })],
      { requirements: [celiac] },
    );

    expect(listing.score).toBe(7.2); // 2 * 0.6 * 6
    expect(osm.score).toBe(5.04); // 2 * (0.6 * 0.7) * 6
    expect(osm.score).toBeLessThan(listing.score);
  });

  it("says so on the line, so a discount is never silent", () => {
    const osm = scorePlace(
      [ev({ polarity: "supports", confidence: 0.6, source: "openstreetmap" })],
      { requirements: [celiac] },
    );
    expect(osm.breakdown[0]?.discounted).toBe(true);

    const listing = scorePlace(
      [ev({ polarity: "supports", confidence: 0.6, source: "google_maps" })],
      { requirements: [celiac] },
    );
    expect(listing.breakdown[0]?.discounted).toBeUndefined();
  });

  it("keeps a community tag below the explicit-mark threshold", () => {
    // `diet:gluten_free=only` is read at 0.95 by the OSM adapter, which would
    // otherwise be reported as an EXPLICIT mark of kitchen safety on the
    // strength of one volunteer's tag. 0.95 * 0.7 = 0.665, below 0.8.
    const s = scorePlace(
      [ev({ polarity: "supports", confidence: 0.95, source: "openstreetmap" })],
      { requirements: [celiac] },
    );
    expect(s.breakdown.map((l) => l.rule)).toEqual(["supported"]);

    const listing = scorePlace(
      [ev({ polarity: "supports", confidence: 0.95, source: "google_maps" })],
      { requirements: [celiac] },
    );
    expect(listing.breakdown.map((l) => l.rule)).toEqual(["explicit"]);
  });

  it("does NOT discount a contradiction", () => {
    // The asymmetry is deliberate. "A reviewer says they got glutened here" is
    // not a claim to quietly turn down because of where it was found — the cost
    // of under-weighting it is not the same as the cost of over-weighting a
    // volunteer's "yes".
    const osm = scorePlace(
      [ev({ polarity: "contradicts", confidence: 0.85, source: "openstreetmap" })],
      { requirements: [celiac] },
    );
    const listing = scorePlace(
      [ev({ polarity: "contradicts", confidence: 0.85, source: "google_maps" })],
      { requirements: [celiac] },
    );
    expect(osm.score).toBe(listing.score);
    expect(osm.score).toBe(-11.1); // -(1 + 0.85) * 6, undiscounted AND unfloored
  });

  it("scales corroboration by how much independent reliability agrees", () => {
    const withOsm = scorePlace(
      [
        ev({ polarity: "supports", confidence: 0.9, source: "google_maps" }),
        ev({ polarity: "supports", confidence: 0.9, source: "openstreetmap" }),
      ],
      { requirements: [celiac] },
    );
    const withAnotherListing = scorePlace(
      [
        ev({ polarity: "supports", confidence: 0.9, source: "google_maps" }),
        ev({ polarity: "supports", confidence: 0.9, source: "trusted_partner" }),
        ev({ polarity: "supports", confidence: 0.9, source: "third_listing" }),
      ],
      { requirements: [celiac] },
    );

    // 1 + 0.7 - 1 = 0.7 of a bonus, vs 1 + 0.7 + 0.7 - 1 clamped to a full one.
    expect(withOsm.score).toBe(12.9); // 10.8 + 0.5 * 0.7 * 6
    expect(withAnotherListing.score).toBe(13.8); // 10.8 + 0.5 * 1 * 6
    expect(withAnotherListing.score).toBeGreaterThan(withOsm.score);
  });

  it("pays nothing for one source repeating itself", () => {
    // Three quotes off one Google Maps page are one source agreeing with
    // itself, and the reliability sum for a single source is never above 1.
    const s = scorePlace(
      [
        ev({ polarity: "supports", confidence: 0.9, source: "google_maps" }),
        ev({ polarity: "supports", confidence: 0.9, source: "google_maps" }),
        ev({ polarity: "supports", confidence: 0.9, source: "google_maps" }),
      ],
      { requirements: [celiac] },
    );
    expect(s.breakdown.map((l) => l.rule)).toEqual(["explicit"]);
    expect(s.score).toBe(10.8);
  });
});

describe("scorePlace — support is proportional, with no floor under it", () => {
  it("makes a near-worthless claim worth near-nothing", () => {
    // The flaw this replaced: `1 + confidence` gave the mere EXISTENCE of a
    // supporting source half of a perfect score. A claim we were 3.5%
    // confident in scored 6.21 out of 12 — more than half — and both the
    // per-claim confidence and the per-source discount only ever scaled the
    // half above that floor, so neither could move a ranking much.
    const almostNothing = scorePlace(
      [ev({ polarity: "supports", confidence: 0.05, source: "openstreetmap" })],
      { requirements: [celiac] },
    );
    const perfect = scorePlace(
      [ev({ polarity: "supports", confidence: 1, source: "google_maps" })],
      { requirements: [celiac] },
    );

    expect(almostNothing.score).toBe(0.42); // 2 * 0.05 * 0.7 * 6
    expect(perfect.score).toBe(12);
    // Under the old rule this ratio was 6.21 / 12 — over half.
    expect(almostNothing.score / perfect.score).toBeLessThan(0.05);
  });

  it("lets the two discounts actually compound", () => {
    // 3 Amigos: `diet:gluten_free=yes` (0.6, because options are not a
    // dedicated kitchen) from OpenStreetMap (0.7, because nobody reviewed it).
    // Both discounts now reach the number instead of nibbling at the half
    // above a constant.
    const amigos = scorePlace(
      [ev({ polarity: "supports", confidence: 0.6, source: "openstreetmap" })],
      { requirements: [celiac] },
    );
    expect(amigos.score).toBe(5.04); // 2 * 0.6 * 0.7 * 6, was 8.52
    expect(amigos.breakdown[0]?.discounted).toBe(true);
  });

  it("keeps the floor under a CONTRADICTION", () => {
    // Deliberately not symmetrical, and for the same reason contradictions are
    // not discounted by source: a claim that a place is safe should have to
    // earn its score, and a claim that it made someone ill should count even
    // when the source hedges.
    const hedged = scorePlace(
      [ev({ polarity: "contradicts", confidence: 0.1 })],
      { requirements: [celiac] },
    );
    const supportive = scorePlace(
      [ev({ polarity: "supports", confidence: 0.1 })],
      { requirements: [celiac] },
    );
    expect(hedged.score).toBe(-6.6); // -(1 + 0.1) * 6 — the floor holds
    expect(supportive.score).toBe(1.2); // 2 * 0.1 * 6 — no floor
    expect(Math.abs(hedged.score)).toBeGreaterThan(supportive.score);
  });

  it("still cannot exceed the ceiling the dossier divides by", () => {
    const max = maxAchievableScore([celiac]);
    for (const confidence of [0, 0.25, 0.5, 0.8, 0.95, 1]) {
      const s = scorePlace(
        ["google_maps", "trusted_partner", "third_listing"].map((source) =>
          ev({ polarity: "supports", confidence, source }),
        ),
        { requirements: [celiac] },
      );
      expect(s.score).toBeLessThanOrEqual(max);
    }
  });
});
