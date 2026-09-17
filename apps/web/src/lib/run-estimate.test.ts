import { describe, expect, it } from "vitest";
import {
  DEFAULT_BASELINE_MS,
  estimateRun,
  formatElapsed,
  medianMs,
  roundRemaining,
} from "./run-estimate.ts";

describe("medianMs", () => {
  it("takes the middle of an odd sample", () => {
    expect(medianMs([30_000, 10_000, 20_000])).toBe(20_000);
  });

  it("averages the middle pair of an even sample", () => {
    expect(medianMs([10_000, 20_000, 30_000, 40_000])).toBe(25_000);
  });

  it("is undefined with no usable history", () => {
    expect(medianMs([])).toBeUndefined();
    expect(medianMs([0, -5])).toBeUndefined();
  });

  it("is not dragged by a single timed-out outlier the way a mean would be", () => {
    expect(medianMs([60_000, 62_000, 64_000, 480_000])).toBeLessThan(100_000);
  });
});

describe("estimateRun", () => {
  it("leans on the baseline before there is progress to extrapolate from", () => {
    const { totalMs } = estimateRun({
      fraction: 0,
      elapsedMs: 1_000,
      baselineMs: 60_000,
    });
    expect(totalMs).toBe(60_000);
  });

  it("falls back to a default when the user has no run history", () => {
    expect(estimateRun({ fraction: 0, elapsedMs: 0 }).totalMs).toBe(
      DEFAULT_BASELINE_MS,
    );
  });

  it("blends this run's own pace in once there is enough of it", () => {
    // Halfway in 100s projects a 200s run, weighted against a 60s baseline.
    // At fraction 0.5 the run's own pace already carries most of the weight —
    // the blend shifts from baseline to projection as the run reveals itself,
    // rather than staying 50/50 forever.
    const { totalMs } = estimateRun({
      fraction: 0.5,
      elapsedMs: 100_000,
      baselineMs: 60_000,
    });
    expect(totalMs).toBeGreaterThan(130_000);
    expect(totalMs).toBeLessThan(200_000);
  });

  it("leans on the baseline early and on this run late", () => {
    const early = estimateRun({ fraction: 0.06, elapsedMs: 12_000, baselineMs: 60_000 });
    // 6% in 12s projects 200s, but 12 seconds is far too little to extrapolate
    // a whole run from, so the 60s baseline still dominates.
    expect(early.totalMs).toBeLessThan(80_000);

    const late = estimateRun({ fraction: 0.8, elapsedMs: 160_000, baselineMs: 60_000 });
    // 80% in 160s projects 200s, and by now this run knows more about itself
    // than a median over past runs does.
    expect(late.totalMs).toBe(200_000);
  });

  it("never promises past the job's own budget", () => {
    const { totalMs, remainingMs } = estimateRun({
      fraction: 0.1,
      elapsedMs: 60_000,
      baselineMs: 900_000,
      timeoutMs: 120_000,
    });
    expect(totalMs).toBe(120_000);
    expect(remainingMs).toBe(60_000);
  });

  it("reports 0 remaining, never a negative, on a run that outlived the estimate", () => {
    const { remainingMs } = estimateRun({
      fraction: 0.2,
      elapsedMs: 300_000,
      baselineMs: 60_000,
      timeoutMs: 120_000,
    });
    expect(remainingMs).toBe(0);
  });
});

describe("formatElapsed", () => {
  it("reads as a stopwatch, zero-padded", () => {
    expect(formatElapsed(0)).toBe("0:00");
    expect(formatElapsed(9_000)).toBe("0:09");
    expect(formatElapsed(125_000)).toBe("2:05");
  });

  it("never renders a negative clock", () => {
    expect(formatElapsed(-5_000)).toBe("0:00");
  });
});

describe("roundRemaining", () => {
  it("buckets short waits to 10s, in seconds", () => {
    expect(roundRemaining(23_000)).toEqual({ value: 20, unit: "sec" });
  });

  it("never rounds down to a zero that would read as 'finished'", () => {
    expect(roundRemaining(1_000)).toEqual({ value: 10, unit: "sec" });
    expect(roundRemaining(0)).toEqual({ value: 10, unit: "sec" });
  });

  it("switches to whole minutes past 90s", () => {
    expect(roundRemaining(100_000)).toEqual({ value: 2, unit: "min" });
    expect(roundRemaining(500_000)).toEqual({ value: 8, unit: "min" });
  });
});

describe("over budget is not the same as finishing up", () => {
  it("flags a run that has outlived its budget", () => {
    // What the user saw: "finishing up" beside a bar at 60%, with minutes of
    // work still to come. The estimate is clamped to the budget, elapsed has
    // passed it, and the subtraction bottoms out at zero.
    const estimate = estimateRun({
      fraction: 0.6,
      elapsedMs: 600_000,
      timeoutMs: 480_000,
    });
    expect(estimate.overBudget).toBe(true);
    expect(estimate.remainingMs).toBe(0);
  });

  it("does not flag a run that is merely close to its budget", () => {
    const estimate = estimateRun({
      fraction: 0.9,
      elapsedMs: 470_000,
      timeoutMs: 480_000,
    });
    expect(estimate.overBudget).toBe(false);
  });

  it("never flags a run with no budget to exceed", () => {
    expect(estimateRun({ fraction: 0.5, elapsedMs: 10_000_000 }).overBudget).toBe(false);
  });
});
