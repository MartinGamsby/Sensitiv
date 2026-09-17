import { describe, expect, it } from "vitest";
import type { DossierPlace, PlannedRequirement } from "@sensitiv/shared";
import {
  placesWithDistance,
  requirementSortOptions,
  sortFromValue,
  sortPlaces,
  sortToValue,
} from "./dossier-sort.ts";

const CENTER = { lat: 45.582, lng: -73.5829 };

function place(
  name: string,
  score: number,
  coords?: { lat: number; lng: number },
  evidence: { requirementId: string; polarity: "supports" | "contradicts" | "unclear"; confidence?: number }[] = [],
): DossierPlace {
  return {
    place: { name, canonicalKey: name.toLowerCase(), ...coords },
    sources: [],
    evidence: evidence.map((e) => ({
      requirementId: e.requirementId,
      claim: "c",
      polarity: e.polarity,
      quote: "",
      source: "google_maps",
      sourceUrl: "https://example.com",
      confidence: e.confidence ?? 0.5,
    })),
    score,
    conflicted: false,
  };
}

const celiac: PlannedRequirement = {
  id: "celiac",
  catalogId: "celiac",
  label: "Celiac",
  intentIds: ["dining"],
  must: [],
  nice: [],
  weight: 3,
  satisfiedBy: [],
};
const italian: PlannedRequirement = {
  id: "custom_italian",
  label: "Italian",
  intentIds: ["dining"],
  must: [],
  nice: [],
  weight: 1,
  satisfiedBy: [],
};

describe("placesWithDistance", () => {
  it("measures each place against the origin", () => {
    // ~1.8 km, the Ottavio case.
    const [p] = placesWithDistance([place("Ottavio", 5, { lat: 45.5957, lng: -73.5709 })], CENTER);
    expect(p!.distanceKm).toBeGreaterThan(1.5);
    expect(p!.distanceKm).toBeLessThan(2.1);
  });

  it("leaves a place with no coordinates unmeasured", () => {
    const [p] = placesWithDistance([place("Nowhere", 1)], CENTER);
    expect(p!.distanceKm).toBeUndefined();
  });

  it("measures nothing when the run recorded no centre", () => {
    // Every run written before the centre was stored.
    const [p] = placesWithDistance([place("A", 1, { lat: 45.5, lng: -73.5 })], undefined);
    expect(p!.distanceKm).toBeUndefined();
  });

  it("can measure the same places from a different origin", () => {
    // The point of storing the centre rather than a distance: the same dossier
    // is re-measurable from anywhere without re-running the search.
    const places = [place("A", 1, { lat: 45.5957, lng: -73.5709 })];
    const fromCenter = placesWithDistance(places, CENTER)[0]!.distanceKm!;
    const fromElsewhere = placesWithDistance(places, { lat: 45.5019, lng: -73.5674 })[0]!.distanceKm!;
    expect(fromElsewhere).toBeGreaterThan(fromCenter);
  });
});

describe("sortPlaces", () => {
  const near = place("Near", 2, { lat: 45.5957, lng: -73.5709 });
  const far = place("Far", 6, { lat: 45.5167, lng: -73.5739 });
  const unplaced = place("Unplaced", 4);
  const all = placesWithDistance([near, far, unplaced], CENTER);

  it("orders by score under `recommended`", () => {
    expect(sortPlaces(all, { kind: "recommended" }).map((p) => p.place.name)).toEqual([
      "Far",
      "Unplaced",
      "Near",
    ]);
  });

  it("orders by distance under `closest`, with unmeasured places last", () => {
    // "We do not know where this is" must never be presented as "this is right
    // here", which is what sorting an undefined distance as 0 would do.
    expect(sortPlaces(all, { kind: "closest" }).map((p) => p.place.name)).toEqual([
      "Near",
      "Far",
      "Unplaced",
    ]);
  });

  it("orders by how well a requirement is settled", () => {
    const places = placesWithDistance(
      [
        place("Weak", 9, undefined, [{ requirementId: "celiac", polarity: "supports", confidence: 0.55 }]),
        place("Strong", 1, undefined, [{ requirementId: "celiac", polarity: "supports", confidence: 0.95 }]),
        place("Against", 8, undefined, [{ requirementId: "celiac", polarity: "contradicts" }]),
      ],
      CENTER,
    );
    expect(
      sortPlaces(places, { kind: "requirement", requirementId: "celiac" }).map((p) => p.place.name),
    ).toEqual(["Strong", "Weak", "Against"]);
  });

  it("breaks every tie on the overall score", () => {
    const tied = placesWithDistance(
      [place("Low", 1, undefined, []), place("High", 9, undefined, [])],
      CENTER,
    );
    expect(
      sortPlaces(tied, { kind: "requirement", requirementId: "celiac" }).map((p) => p.place.name),
    ).toEqual(["High", "Low"]);
  });

  it("NEVER drops a place — this orders, it does not filter", () => {
    // A dossier whose list silently shrank would make "nothing matched" and
    // "nothing nearby" indistinguishable, which is a bad thing to hand someone
    // working out where they can safely eat.
    for (const sort of [
      { kind: "recommended" } as const,
      { kind: "closest" } as const,
      { kind: "requirement", requirementId: "celiac" } as const,
      { kind: "requirement", requirementId: "nonexistent" } as const,
    ]) {
      expect(sortPlaces(all, sort)).toHaveLength(all.length);
    }
  });

  it("does not mutate the array it was given", () => {
    const original = all.map((p) => p.place.name);
    sortPlaces(all, { kind: "closest" });
    expect(all.map((p) => p.place.name)).toEqual(original);
  });
});

describe("requirementSortOptions", () => {
  it("offers only requirements some place actually has evidence for", () => {
    // An option that reorders nothing reads as a broken control.
    const places = [
      place("A", 1, undefined, [{ requirementId: "celiac", polarity: "supports" }]),
    ];
    expect(requirementSortOptions([celiac, italian], places).map((r) => r.id)).toEqual([
      "celiac",
    ]);
  });

  it("ignores `unclear` evidence, which settles nothing", () => {
    const places = [
      place("A", 1, undefined, [{ requirementId: "italian", polarity: "unclear" }]),
    ];
    expect(requirementSortOptions([italian], places)).toEqual([]);
  });

  it("puts the safety-critical requirement first", () => {
    const places = [
      place("A", 1, undefined, [
        { requirementId: "custom_italian", polarity: "supports" },
        { requirementId: "celiac", polarity: "supports" },
      ]),
    ];
    expect(requirementSortOptions([italian, celiac], places).map((r) => r.id)).toEqual([
      "celiac",
      "custom_italian",
    ]);
  });
});

describe("sort values round-trip through the select", () => {
  it("survives a round trip", () => {
    for (const sort of [
      { kind: "recommended" } as const,
      { kind: "closest" } as const,
      { kind: "requirement", requirementId: "celiac" } as const,
    ]) {
      expect(sortFromValue(sortToValue(sort))).toEqual(sort);
    }
  });

  it("falls back to `recommended` for anything unrecognised", () => {
    expect(sortFromValue("nonsense")).toEqual({ kind: "recommended" });
    expect(sortFromValue("")).toEqual({ kind: "recommended" });
  });
});
