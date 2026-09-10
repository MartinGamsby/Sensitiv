import { describe, expect, it } from "vitest";
import type { Evidence } from "@sensitiv/shared";
import { scorePlace } from "./score.ts";

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

describe("scorePlace rubric", () => {
  it("+2 when a source explicitly marks the requirement (confident support)", () => {
    const s = scorePlace([
      ev({ polarity: "supports", confidence: 0.9, source: "google_maps" }),
      ev({ polarity: "supports", confidence: 0.5, source: "yelp" }),
    ]);
    expect(s.breakdown.find((l) => l.rule === "+2")).toBeDefined();
    expect(s.score).toBe(3); // +2 explicit and +1 multiple support
    expect(s.conflicted).toBe(false);
  });

  it("+1 when multiple reviews support it (no single confident mark)", () => {
    const s = scorePlace([
      ev({ polarity: "supports", confidence: 0.5, source: "google_maps" }),
      ev({ polarity: "supports", confidence: 0.6, source: "yelp" }),
    ]);
    expect(s.breakdown.map((l) => l.rule)).toEqual(["+1"]);
    expect(s.score).toBe(1);
  });

  it("-2 when reviews contradict it", () => {
    const s = scorePlace([
      ev({ polarity: "contradicts", source: "google_maps" }),
      ev({ polarity: "contradicts", source: "yelp" }),
    ]);
    expect(s.breakdown.map((l) => l.rule)).toEqual(["-2"]);
    expect(s.score).toBe(-2);
  });

  it("-1 when a single source is the only weak mention", () => {
    const s = scorePlace([
      ev({ polarity: "supports", confidence: 0.4, source: "google_maps" }),
    ]);
    expect(s.breakdown.map((l) => l.rule)).toEqual(["-1"]);
    expect(s.score).toBe(-1);
  });

  it("conflicted (amber) when one requirement has both polarities; still scored", () => {
    const s = scorePlace([
      ev({ polarity: "supports", confidence: 0.9, source: "google_maps" }),
      ev({ polarity: "contradicts", confidence: 0.6, source: "yelp" }),
    ]);
    expect(s.conflicted).toBe(true);
    expect(s.breakdown.map((l) => l.rule).sort()).toEqual(["+2", "-2"]);
    expect(s.score).toBe(0);
  });
});
