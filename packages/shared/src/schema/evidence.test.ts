import { describe, expect, it } from "vitest";
import {
  EvidenceSchema,
  requirementStanding,
  type Evidence,
} from "./evidence.ts";

describe("requirementStanding", () => {
  const ev = (over: Partial<Evidence> & { polarity: Evidence["polarity"] }): Evidence =>
    EvidenceSchema.parse({
      requirementId: "celiac",
      claim: "c",
      quote: "",
      source: "google_maps",
      sourceUrl: "https://example.com",
      confidence: 0.5,
      ...over,
    });

  it("ranks by the extractor's own confidence, not just by polarity", () => {
    // "categorised as a gluten-free restaurant" must sort above "one review
    // mentions it" rather than tying with it.
    const strong = requirementStanding([ev({ polarity: "supports", confidence: 0.95 })], "celiac");
    const weak = requirementStanding([ev({ polarity: "supports", confidence: 0.55 })], "celiac");
    expect(strong).toBeGreaterThan(weak);
  });

  it("is 0 when nothing settled the requirement", () => {
    expect(requirementStanding([], "celiac")).toBe(0);
    expect(requirementStanding([ev({ polarity: "unclear" })], "celiac")).toBe(0);
  });

  it("goes negative when contradicted", () => {
    expect(requirementStanding([ev({ polarity: "contradicts" })], "celiac")).toBeLessThan(0);
  });

  it("ignores evidence for other requirements", () => {
    const mixed = [
      ev({ requirementId: "celiac", polarity: "supports", confidence: 0.9 }),
      ev({ requirementId: "access", polarity: "contradicts", confidence: 0.9 }),
    ];
    expect(requirementStanding(mixed, "celiac")).toBeGreaterThan(0);
    expect(requirementStanding(mixed, "access")).toBeLessThan(0);
  });

  it("nets out a requirement with both polarities", () => {
    const conflicted = [
      ev({ polarity: "supports", confidence: 0.9 }),
      ev({ polarity: "contradicts", confidence: 0.9 }),
    ];
    expect(requirementStanding(conflicted, "celiac")).toBe(0);
  });
});
