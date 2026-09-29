import { describe, expect, it } from "vitest";
import scenario from "../../scenarios/mexican-place-des-arts.ts";
import { scenarios } from "../../scenarios/index.ts";
import { copyVars, fillTemplate, parseEmphasis } from "../lib/copy.ts";
import { imageRefs, photoRef } from "../lib/assets.ts";
import { defineScenario } from "./scenario.ts";

describe("the committed scenarios", () => {
  it("all validate and have distinct ids", () => {
    expect(scenarios.length).toBeGreaterThan(0);
    expect(new Set(scenarios.map((s) => s.id)).size).toBe(scenarios.length);
  });

  it("search for what their run searched for", () => {
    for (const s of scenarios) {
      expect(s.search.request).toBe(s.run.request);
      expect(s.search.radiusKm).toBe(s.run.location.radiusKm);
      expect(s.run.requirements.map((r) => r.id)).toContain(s.search.requirement);
      expect(s.search.intents).toEqual(s.run.intents);
      if (s.run.location.lat !== undefined && s.run.location.lng !== undefined) {
        expect(s.search.pin.lat).toBeCloseTo(s.run.location.lat, 3);
        expect(s.search.pin.lng).toBeCloseTo(s.run.location.lng, 3);
      }
    }
  });

  it("never show a run built on sample data without saying so", () => {
    // A scenario may use one only through --allow-sample-data, and then the
    // dossier shows the app's own warning; this pins the committed demo live.
    expect(Object.values(scenario.run.sourceModes)).not.toContain("fixture");
  });
});

describe("defineScenario", () => {
  it("names the field that is wrong", () => {
    expect(() =>
      defineScenario({ ...scenario, search: { ...scenario.search, radiusKm: -1 } }),
    ).toThrow(/search\.radiusKm/);
    expect(() => defineScenario({ ...scenario, id: "Has Spaces" })).toThrow(/scenario "Has Spaces"[\s\S]*id/);
  });

  it("fills in every timing it is not given", () => {
    expect(scenario.timing.research).toBe(9);
    const faster = defineScenario({ ...scenario, timing: { research: 6 } });
    expect(faster.timing.research).toBe(6);
    expect(faster.timing.hook).toBe(5.5);
  });
});

describe("copy", () => {
  it("fills placeholders from the run", () => {
    const vars = copyVars(scenario);
    expect(fillTemplate("{places} places around {pin}, {radius} km", vars)).toBe(
      "15 places around Place des Arts, 1 km",
    );
    expect(vars.sources).toBe("Google Maps and OpenStreetMap");
    expect(vars.duration).toBe("2:09");
    expect(vars.requirement).toBe("Celiac");
  });

  it("leaves an unknown placeholder visible rather than blank", () => {
    expect(fillTemplate("{nope}", {})).toBe("{nope}");
  });

  it("turns *asterisks* into accents, and leaves a lone one alone", () => {
    expect(parseEmphasis("isn't the same as *safe*.")).toEqual([
      { text: "isn't the same as ", accent: false },
      { text: "safe", accent: true },
      { text: ".", accent: false },
    ]);
    expect(parseEmphasis("5 * 3")).toEqual([{ text: "5 * 3", accent: false }]);
  });
});

describe("images", () => {
  it("lets a scenario override or blank one place's photo", () => {
    const withPhotos = defineScenario({
      ...scenario,
      images: { photos: { "La Toxica": "photos/toxica.jpg", "Escondite Union": null } },
    });
    const toxica = withPhotos.run.places.find((p) => p.name === "La Toxica")!;
    const union = withPhotos.run.places.find((p) => p.name === "Escondite Union")!;
    expect(photoRef(withPhotos, toxica.name, toxica.photo)).toBe("photos/toxica.jpg");
    expect(photoRef(withPhotos, union.name, union.photo)).toBeUndefined();
    expect(imageRefs(withPhotos)).toContain("photos/toxica.jpg");
    expect(imageRefs(withPhotos)).not.toContain(union.photo);
  });
});
