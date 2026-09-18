import { describe, expect, it } from "vitest";
import type { PlannedRequirement } from "./requirement.ts";
import {
  MAX_REQUIREMENT_BASE,
  PROXIMITY_MAX,
  maxAchievableScore,
  scorePercent,
} from "./score.ts";

function requirement(id: string, weight: number): PlannedRequirement {
  return {
    id,
    label: id,
    intentIds: ["dining"],
    must: [],
    nice: [],
    weight,
    satisfiedBy: [],
  };
}

describe("maxAchievableScore", () => {
  it("is the per-requirement ceiling times each weight", () => {
    expect(maxAchievableScore([requirement("celiac", 3)])).toBe(
      3 * MAX_REQUIREMENT_BASE,
    );
    expect(
      maxAchievableScore([requirement("celiac", 3), requirement("access", 2)]),
    ).toBe(5 * MAX_REQUIREMENT_BASE);
  });

  it("adds the proximity term only when the run recorded a centre", () => {
    const reqs = [requirement("celiac", 3)];
    expect(maxAchievableScore(reqs, { withProximity: true })).toBe(
      3 * MAX_REQUIREMENT_BASE + PROXIMITY_MAX,
    );
    expect(maxAchievableScore(reqs, { withProximity: false })).toBe(
      3 * MAX_REQUIREMENT_BASE,
    );
  });

  it("is 0 — not a proximity-only ceiling — when nothing was researched", () => {
    // Otherwise a run with no requirements would divide by 2 and report a
    // percentage built entirely out of how close the place happened to be.
    expect(maxAchievableScore([], { withProximity: true })).toBe(0);
  });
});

describe("scorePercent", () => {
  it("reads a raw score against the run's ceiling", () => {
    expect(scorePercent(9.5, 9.5)).toBe(100);
    expect(scorePercent(4.75, 9.5)).toBe(50);
    expect(scorePercent(0, 9.5)).toBe(0);
  });

  it("clamps a contradicted place to 0 rather than showing a negative percent", () => {
    expect(scorePercent(-6, 9.5)).toBe(0);
  });

  it("declines to state a percentage when there is no ceiling to divide by", () => {
    expect(scorePercent(5, 0)).toBeUndefined();
    expect(scorePercent(5, -1)).toBeUndefined();
    expect(scorePercent(Number.NaN, 9.5)).toBeUndefined();
  });

  it("is monotonic, so the percentage can never reorder the ranking", () => {
    const max = 9.5;
    const scores = [-2, 0, 1.4, 5.85, 7.2, 9.5];
    const percents = scores.map((s) => scorePercent(s, max)!);
    for (let i = 1; i < percents.length; i += 1) {
      expect(percents[i]!).toBeGreaterThanOrEqual(percents[i - 1]!);
    }
  });
});
