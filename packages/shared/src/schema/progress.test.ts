import { describe, expect, it } from "vitest";
import {
  RUN_PHASES,
  RUN_PHASE_COUNT,
  JobProgressSchema,
  latestProgress,
  nextProgressFraction,
  phaseNumber,
  progressFraction,
} from "./progress.ts";

describe("progressFraction", () => {
  it("advances monotonically through the phases", () => {
    const fractions = RUN_PHASES.map((phase) => progressFraction({ phase }));
    for (let i = 1; i < fractions.length; i++) {
      expect(fractions[i]!).toBeGreaterThan(fractions[i - 1]!);
    }
  });

  it("stays strictly inside [0, 1) — the last sliver belongs to the terminal state", () => {
    for (const phase of RUN_PHASES) {
      const f = progressFraction({ phase, done: 99, total: 99 });
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThanOrEqual(1);
    }
    expect(progressFraction({ phase: "start" })).toBeLessThan(0.1);
  });

  it("interpolates sub-steps inside a phase", () => {
    const none = progressFraction({ phase: "sources", done: 0, total: 4 });
    const half = progressFraction({ phase: "sources", done: 2, total: 4 });
    const all = progressFraction({ phase: "sources", done: 4, total: 4 });
    expect(half).toBeGreaterThan(none);
    expect(all).toBeGreaterThan(half);
  });

  it("treats an uncountable phase as half-done, so entering it still moves the bar", () => {
    const entered = progressFraction({ phase: "sources" });
    expect(entered).toBeGreaterThan(progressFraction({ phase: "plan" }));
  });

  it("clamps a `done` that overshoots `total` instead of running past the phase", () => {
    expect(progressFraction({ phase: "sources", done: 9, total: 3 })).toBe(
      progressFraction({ phase: "sources", done: 3, total: 3 }),
    );
  });
});

describe("nextProgressFraction", () => {
  it("is the fraction of one more sub-step", () => {
    const p = { phase: "sources", done: 1, total: 4 } as const;
    expect(nextProgressFraction(p)).toBe(
      progressFraction({ ...p, done: 2 }),
    );
  });

  it("is the end of the phase — i.e. the start of the next — with no sub-steps left", () => {
    const atEnd = nextProgressFraction({ phase: "sources", done: 3, total: 3 });
    expect(atEnd).toBeCloseTo(
      progressFraction({ phase: "merge", done: 0, total: 1 }),
      6,
    );
    // Strictly short of the next phase's own midpoint: the bar must not claim
    // merging has started just because every source is in.
    expect(atEnd).toBeLessThan(progressFraction({ phase: "merge" }));
  });

  it("always sits ahead of the marker it follows", () => {
    for (const phase of RUN_PHASES) {
      const p = { phase, done: 0, total: 2 } as const;
      expect(nextProgressFraction(p)).toBeGreaterThan(progressFraction(p));
    }
  });
});

describe("phaseNumber", () => {
  it("numbers the phases 1..N for the 'step X of Y' read-out", () => {
    expect(phaseNumber("start")).toBe(1);
    expect(phaseNumber("dossier")).toBe(RUN_PHASE_COUNT);
  });
});

describe("latestProgress", () => {
  const at = (ms: number) => new Date(ms).toISOString();

  it("returns the last tagged event with its row timestamp", () => {
    const found = latestProgress([
      { ts: at(1_000), progress: { phase: "start" } },
      { ts: at(2_000) },
      { ts: at(3_000), progress: { phase: "sources", done: 1, total: 2 } },
      { ts: at(4_000) },
    ]);
    expect(found?.progress.phase).toBe("sources");
    // The MARKER's time, not the last event's — that is what the bar creeps from.
    expect(found?.atMs).toBe(3_000);
  });

  it("is undefined when nothing in the stream carries progress", () => {
    expect(latestProgress([{ ts: at(1) }, { ts: at(2) }])).toBeUndefined();
  });

  it("falls back to now on an unparseable timestamp rather than producing NaN", () => {
    const found = latestProgress([{ ts: "not-a-date", progress: { phase: "plan" } }]);
    expect(Number.isNaN(found!.atMs)).toBe(false);
  });
});

describe("JobProgressSchema", () => {
  it("rejects a phase that is not in the run", () => {
    expect(JobProgressSchema.safeParse({ phase: "nope" }).success).toBe(false);
  });

  it("accepts a bare phase with no sub-step counts", () => {
    expect(JobProgressSchema.safeParse({ phase: "merge" }).success).toBe(true);
  });
});

describe("the bar is driven by `within`, the label by `done`/`total`", () => {
  it("three no-op stubs finishing barely move the bar", () => {
    // The regression: `sources` derived the bar from the ADAPTER COUNT, and 3
    // of a dining job's 4 adapters are v1.1 stubs that return nothing in under
    // a millisecond. The bar hit 71% of the whole run one second in and then
    // sat motionless for the five minutes the one real adapter took.
    const byAdapterCount = progressFraction({ phase: "sources", done: 3, total: 4 });
    expect(byAdapterCount).toBeCloseTo(0.7125, 3);

    // Weighted by real work — 3 stubs at 1, one browser adapter at 20 — the
    // same moment is a small fraction of the phase.
    const byWork = progressFraction({
      phase: "sources",
      within: 3 / 23,
      done: 3,
      total: 4,
      unit: "source",
    });
    expect(byWork).toBeLessThan(0.26);
    expect(byWork).toBeGreaterThan(weightBefore);
  });

  it("`within` wins over `done`/`total` for the bar", () => {
    // The label says "place 1 of 22" while the bar is most of the way through
    // the phase. Both are correct; they answer different questions.
    const fraction = progressFraction({
      phase: "sources",
      within: 0.9,
      done: 1,
      total: 22,
      unit: "place",
    });
    expect(fraction).toBeCloseTo(weightBefore + 0.75 * 0.9, 5);
  });

  it("clamps a `within` outside 0..1 rather than escaping the phase", () => {
    expect(progressFraction({ phase: "sources", within: 5 })).toBeCloseTo(
      weightBefore + 0.75,
      5,
    );
    expect(progressFraction({ phase: "sources", within: -2 })).toBeCloseTo(weightBefore, 5);
  });

  it("still falls back to the unit count when nothing reports `within`", () => {
    expect(progressFraction({ phase: "sources", done: 1, total: 4 })).toBeCloseTo(
      weightBefore + 0.75 * 0.25,
      5,
    );
  });

  it("the creep target advances from `within`, not from the unit count", () => {
    // Otherwise the target would jump backwards at the query -> place handover,
    // where the unit count restarts at 0 but the bar has not moved back.
    const marker = { phase: "sources", within: 0.5, done: 3, total: 10, unit: "place" } as const;
    const next = nextProgressFraction(marker);
    expect(next).toBeGreaterThan(progressFraction(marker));
    expect(next).toBeCloseTo(weightBefore + 0.75 * 0.6, 5);
  });

  it("never creeps past the end of its phase", () => {
    const next = nextProgressFraction({
      phase: "sources",
      within: 0.99,
      done: 1,
      total: 2,
      unit: "place",
    });
    expect(next).toBeLessThanOrEqual(weightBefore + 0.75 + 1e-9);
  });
});

/** Cumulative weight of `start` + `plan`, the phases before `sources`. */
const weightBefore = progressFraction({ phase: "sources", within: 0 });
