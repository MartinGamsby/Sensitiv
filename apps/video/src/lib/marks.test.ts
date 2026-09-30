import { describe, expect, it } from "vitest";
import scenario from "../../scenarios/mexican-place-des-arts.ts";
import type { RunSnapshot } from "../config/run-snapshot.ts";
import {
  consensusFor,
  dossierNotices,
  evidenceFor,
  formatDelta,
  parseTagQuote,
  placeDistanceKm,
  placePercent,
  requirementMarks,
} from "./marks.ts";

// The committed run is a real one, and these are the numbers its dossier
// shows in the app — the video must not show different ones.
const run = scenario.run;
const laSelva = run.places[0]!;

describe("the numbers on a card", () => {
  it("matches the app's Match % and requirement pills for the top place", () => {
    expect(laSelva.name).toBe("La Selva restaurant mexicain");
    expect(placePercent(run, laSelva)).toBe(44);
    const marks = requirementMarks(laSelva.breakdown);
    expect(marks.map((m) => [m.requirementId, m.percent, m.tone])).toEqual([
      ["celiac", 48, "ok"],
      ["custom_mexican_restaurant", 76, "ok"],
    ]);
  });

  it("shows '?' — not 0% — for a requirement nothing settled", () => {
    const laToxica = run.places.find((p) => p.name === "La Toxica")!;
    const celiac = requirementMarks(laToxica.breakdown).find((m) => m.requirementId === "celiac")!;
    expect(celiac.settled).toBe(false);
    expect(celiac.percent).toBeUndefined();
    expect(celiac.tone).toBe("neutral");
  });

  it("puts the ticked chip before the cuisine", () => {
    for (const place of run.places) {
      const marks = requirementMarks(place.breakdown);
      if (marks.length > 1) expect(marks[0]!.requirementId).toBe("celiac");
    }
  });

  it("measures distance from the run's centre", () => {
    expect(placeDistanceKm(run, laSelva)).toBe(2.06);
  });
});

describe("the detail view", () => {
  it("captions a score line with the claim behind it", () => {
    const line = laSelva.breakdown.find((l) => l.requirementId === "celiac")!;
    expect(evidenceFor(laSelva.evidence, line)).toEqual({
      claim: "A reviewer identifying as celiac reported eating safely at the restaurant",
      sources: ["google_maps"],
    });
  });

  it("calls a single source a single source", () => {
    expect(consensusFor(laSelva.evidence.filter((e) => e.requirementId === "celiac"))).toBe("single");
  });

  it("reads an OpenStreetMap tag as a tag", () => {
    expect(parseTagQuote("diet:gluten_free=yes")).toEqual({ key: "diet:gluten_free", value: "yes" });
    expect(parseTagQuote("gluten free = life")).toBeUndefined();
  });

  it("formats deltas the way the breakdown does", () => {
    expect(formatDelta(7.199999999)).toBe("+7.2");
    expect(formatDelta(-2)).toBe("-2");
    expect(formatDelta(0)).toBe("0");
  });
});

describe("dossierNotices", () => {
  it("says nothing for a run whose sources all answered live", () => {
    expect(dossierNotices(run)).toEqual([]);
  });

  it("names sample data and unavailable sources, like the app's strips", () => {
    const mixed: RunSnapshot = {
      ...run,
      sourceModes: { llm: "live", google_maps: "fixture", openstreetmap: "unavailable" },
    };
    expect(dossierNotices(mixed)).toEqual([
      { kind: "sampleData", sources: ["google_maps"] },
      { kind: "unavailable", sources: ["openstreetmap"] },
    ]);
  });
});
