import { describe, expect, it } from "vitest";
import type { ScoreLine } from "@sensitiv/shared";
import {
  formatDelta,
  markTone,
  requirementMarks,
  type RequirementMark,
} from "./requirement-marks.ts";

function line(over: Partial<ScoreLine> & { rule: ScoreLine["rule"] }): ScoreLine {
  return {
    requirementId: "celiac",
    delta: 0,
    weight: 6,
    reason: "",
    ...over,
  };
}

describe("requirementMarks", () => {
  it("sums every line for a requirement and keeps its weight", () => {
    const marks = requirementMarks([
      line({ rule: "supported", delta: 9.6 }),
      line({ rule: "corroborated", delta: 3 }),
    ]);
    expect(marks).toHaveLength(1);
    expect(marks[0]).toMatchObject({
      requirementId: "celiac",
      delta: 12.6,
      weight: 6,
      settled: true,
      conflicted: false,
    });
  });

  it("drops the proximity line", () => {
    // Distance is a fact about the place, not about anything the user asked
    // for, and it carries no requirement id to pill.
    const marks = requirementMarks([
      line({ rule: "supported", delta: 9.6 }),
      line({ rule: "proximity", requirementId: "", delta: 0.4, weight: 1 }),
    ]);
    expect(marks.map((m) => m.requirementId)).toEqual(["celiac"]);
  });

  it("orders the chips the user ticked ahead of anything the planner minted", () => {
    // The run that motivated the pills: celiac at 6, the cuisine at 3. The
    // cuisine scored HIGHER here, and must still come second.
    const marks = requirementMarks([
      line({ rule: "explicit", requirementId: "custom_mexican", delta: 5.7, weight: 3 }),
      line({ rule: "supported", requirementId: "celiac", delta: 4.8, weight: 6 }),
    ]);
    expect(marks.map((m) => m.requirementId)).toEqual(["celiac", "custom_mexican"]);
  });

  it("keeps the chip first on an older dossier whose stored weights were equal", () => {
    // Breakdowns are persisted at run time, so a dossier from before the chips
    // were worth double still carries weight 3 for celiac. Sorting by weight
    // alone would slide it behind a cuisine that happened to score higher, and
    // the column a reader scans would mean different things on different cards.
    const marks = requirementMarks([
      line({ rule: "explicit", requirementId: "custom_mexican", delta: 5.9, weight: 3 }),
      line({ rule: "supported", requirementId: "celiac", delta: 4.8, weight: 3 }),
    ]);
    expect(marks.map((m) => m.requirementId)).toEqual(["celiac", "custom_mexican"]);
  });

  it("breaks a weight tie by delta, then by id, so renders are stable", () => {
    const marks = requirementMarks([
      line({ rule: "supported", requirementId: "custom_b", delta: 1, weight: 6 }),
      line({ rule: "supported", requirementId: "custom_a", delta: 5, weight: 6 }),
      line({ rule: "supported", requirementId: "custom_c", delta: 1, weight: 6 }),
    ]);
    expect(marks.map((m) => m.requirementId)).toEqual([
      "custom_a",
      "custom_b",
      "custom_c",
    ]);
  });

  it("distinguishes 'nobody said' from 'the sources cancelled out'", () => {
    // Both land on delta 0, and they mean opposite things. The first is an
    // open question; the second is an active disagreement about safety.
    const [unsettled] = requirementMarks([line({ rule: "unverified", delta: 0 })]);
    expect(unsettled).toMatchObject({ delta: 0, settled: false, conflicted: false });
    expect(markTone(unsettled as RequirementMark)).toBe("neutral");

    const [cancelled] = requirementMarks([
      line({ rule: "supported", delta: 9 }),
      line({ rule: "contradicted", delta: -9 }),
    ]);
    expect(cancelled).toMatchObject({ delta: 0, settled: true, conflicted: true });
    expect(markTone(cancelled as RequirementMark)).toBe("warn");
  });

  it("a contradiction with no support is danger, not a conflict", () => {
    const [mark] = requirementMarks([line({ rule: "contradicted", delta: -11.4 })]);
    expect(mark).toMatchObject({ conflicted: false, settled: true });
    expect(markTone(mark as RequirementMark)).toBe("danger");
  });

  it("conflict outranks a net-positive delta", () => {
    // Strong support plus a weaker contradiction still nets positive. It must
    // NOT render green: "one source says this kitchen is unsafe" is the fact a
    // reader skimming a shortlist most needs.
    const [mark] = requirementMarks([
      line({ rule: "explicit", delta: 11.7 }),
      line({ rule: "contradicted", delta: -9 }),
    ]);
    expect(mark?.delta).toBeCloseTo(2.7);
    expect(markTone(mark as RequirementMark)).toBe("warn");
  });

  it("is empty for a place scored before breakdowns were stored", () => {
    expect(requirementMarks([])).toEqual([]);
  });
});

describe("formatDelta", () => {
  it("signs, and keeps one decimal at most", () => {
    expect(formatDelta(9.6)).toBe("+9.6");
    expect(formatDelta(-1.5)).toBe("-1.5");
    expect(formatDelta(0)).toBe("0");
    expect(formatDelta(12)).toBe("+12");
    // Continuous scores reach values like 4.800000000000001.
    expect(formatDelta(4.800000000000001)).toBe("+4.8");
  });
});
