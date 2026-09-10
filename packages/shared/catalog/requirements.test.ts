import { describe, expect, it } from "vitest";
import { intents } from "./intents.ts";
import { allergenOptions, dietOptions, requirements } from "./requirements.ts";

const intentIds = new Set(intents.map((intent) => intent.id));

describe("requirements catalog", () => {
  it("declares the five v1 requirements", () => {
    expect(requirements.map((requirement) => requirement.id)).toEqual([
      "celiac",
      "allergy",
      "mold",
      "diet",
      "access",
    ]);
  });

  it("gives every requirement en + fr labels", () => {
    for (const requirement of requirements) {
      expect(requirement.label.en.length).toBeGreaterThan(0);
      expect(requirement.label.fr.length).toBeGreaterThan(0);
    }
  });

  it("cross-file integrity: every requirement.intents id is a real intent id", () => {
    for (const requirement of requirements) {
      for (const intentId of requirement.intents) {
        expect(intentIds.has(intentId)).toBe(true);
      }
    }
  });

  it("wires the extraFields sub-pickers", () => {
    const allergy = requirements.find((r) => r.id === "allergy");
    const diet = requirements.find((r) => r.id === "diet");
    expect(allergy?.extraFields).toEqual(["allergens"]);
    expect(diet?.extraFields).toEqual(["diet"]);
  });

  it("keeps the celiac negative hint the scoring test depends on", () => {
    const celiac = requirements.find((r) => r.id === "celiac");
    expect(celiac?.negativeHints).toContain("got glutened");
  });

  it("every requirement has must/nice/negative hint arrays", () => {
    for (const requirement of requirements) {
      expect(Array.isArray(requirement.mustHints)).toBe(true);
      expect(Array.isArray(requirement.niceHints)).toBe(true);
      expect(Array.isArray(requirement.negativeHints)).toBe(true);
    }
  });

  it("only references extraFields that have an option list", () => {
    const known = new Set(["allergens", "diet"]);
    for (const requirement of requirements) {
      for (const field of requirement.extraFields ?? []) {
        expect(known.has(field)).toBe(true);
      }
    }
  });
});

describe("sub-picker option lists", () => {
  it("allergenOptions all carry en + fr labels and unique ids", () => {
    const ids = allergenOptions.map((option) => option.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const option of allergenOptions) {
      expect(option.label.en.length).toBeGreaterThan(0);
      expect(option.label.fr.length).toBeGreaterThan(0);
    }
  });

  it("dietOptions cover the documented set", () => {
    expect(dietOptions.map((option) => option.id)).toEqual([
      "halal",
      "kosher",
      "low_fodmap",
      "histamine",
      "other",
    ]);
    for (const option of dietOptions) {
      expect(option.label.en.length).toBeGreaterThan(0);
      expect(option.label.fr.length).toBeGreaterThan(0);
    }
  });
});
