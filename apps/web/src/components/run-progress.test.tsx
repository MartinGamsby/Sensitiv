import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, screen } from "@testing-library/react";
import { creepFraction, RunProgress } from "./run-progress.tsx";
import { renderIntl, wrapIntl } from "../test-support/intl.tsx";

/**
 * The progress bar is a HEURISTIC and says so in words ("about 2 min left").
 * What these tests hold it to is not accuracy — it is that the bar only ever
 * moves forward, never claims work that has not been reported, and never sits
 * frozen during the long `sources` phase.
 */

const NOW = 1_700_000_000_000;

function percent(): number {
  return Number(screen.getByRole("progressbar").getAttribute("aria-valuenow"));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("creepFraction", () => {
  it("starts at the marker and closes on the next milestone without overshooting", () => {
    expect(creepFraction(0.2, 0.5, 0, 60_000)).toBeCloseTo(0.2, 5);
    // Part-way through the span it is strictly between the two.
    const mid = creepFraction(0.2, 0.5, 15_000, 60_000);
    expect(mid).toBeGreaterThan(0.2);
    expect(mid).toBeLessThan(0.5);
    // Left running far past the expected time it saturates AT the milestone —
    // asymptotically below it, and float rounding lands it exactly there. What
    // matters is that it never goes beyond.
    expect(creepFraction(0.2, 0.5, 10 * 60_000, 60_000)).toBeLessThanOrEqual(0.5);
  });

  it("is monotonic in elapsed time", () => {
    let prev = 0;
    for (const ms of [0, 5_000, 15_000, 45_000, 120_000]) {
      const f = creepFraction(0.1, 0.4, ms, 90_000);
      expect(f).toBeGreaterThanOrEqual(prev);
      prev = f;
    }
  });

  it("does not move when the next milestone is not ahead of the marker", () => {
    expect(creepFraction(0.6, 0.6, 60_000, 60_000)).toBe(0.6);
    expect(creepFraction(0.6, 0.4, 60_000, 60_000)).toBe(0.6);
  });
});

describe("<RunProgress />", () => {
  it("names the step and the source it is on", () => {
    renderIntl(
      <RunProgress
        progress={{
          progress: { phase: "sources", done: 1, total: 3 },
          atMs: NOW,
        }}
        startedAtMs={NOW - 30_000}
        terminal={false}
      />,
    );
    expect(screen.getByText(/Step 3 of 5/)).toBeTruthy();
    expect(screen.getByText(/Checking sources/)).toBeTruthy();
    expect(screen.getByText(/source 1 of 3/)).toBeTruthy();
  });

  it("keeps moving between markers, without a new event arriving", () => {
    renderIntl(
      <RunProgress
        progress={{ progress: { phase: "sources", done: 0, total: 3 }, atMs: NOW }}
        startedAtMs={NOW - 10_000}
        baselineMs={120_000}
        terminal={false}
      />,
    );
    const before = percent();
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(percent()).toBeGreaterThan(before);
  });

  it("never runs past the live ceiling while the run is unfinished", () => {
    renderIntl(
      <RunProgress
        progress={{ progress: { phase: "dossier" }, atMs: NOW - 3_600_000 }}
        startedAtMs={NOW - 3_600_000}
        terminal={false}
      />,
    );
    expect(percent()).toBeLessThanOrEqual(97);
  });

  it("does not snap backwards when a marker lands behind the creep", () => {
    const { rerender } = renderIntl(
      <RunProgress
        progress={{ progress: { phase: "sources", done: 2, total: 3 }, atMs: NOW }}
        startedAtMs={NOW - 60_000}
        terminal={false}
      />,
    );
    act(() => {
      vi.advanceTimersByTime(120_000);
    });
    const ahead = percent();
    // A marker for EARLIER work arrives late (out-of-order delivery, or a
    // re-render from a replayed stream).
    rerender(
      wrapIntl(
        <RunProgress
          progress={{ progress: { phase: "sources", done: 0, total: 3 }, atMs: NOW }}
          startedAtMs={NOW - 60_000}
          terminal={false}
        />,
      ),
    );
    expect(percent()).toBeGreaterThanOrEqual(ahead);
  });

  it("shows a full bar and a final duration once the run is terminal", () => {
    renderIntl(
      <RunProgress
        progress={{ progress: { phase: "sources", done: 1, total: 3 }, atMs: NOW }}
        startedAtMs={NOW - 125_000}
        finishedAtMs={NOW}
        terminal
      />,
    );
    expect(percent()).toBe(100);
    expect(screen.getByText("Took 2:05")).toBeTruthy();
    expect(screen.getByText(/All steps complete/)).toBeTruthy();
  });

  it("phrases the estimate as an approximation, not a countdown", () => {
    renderIntl(
      <RunProgress
        progress={{ progress: { phase: "plan" }, atMs: NOW }}
        startedAtMs={NOW - 20_000}
        baselineMs={300_000}
        terminal={false}
      />,
    );
    expect(screen.getByText(/about \d+ min left/)).toBeTruthy();
  });

  it("does not promise time past the job's own budget", () => {
    renderIntl(
      <RunProgress
        progress={{ progress: { phase: "plan" }, atMs: NOW }}
        startedAtMs={NOW - 50_000}
        baselineMs={3_600_000}
        timeoutMs={60_000}
        terminal={false}
      />,
    );
    // 60s budget, 50s gone — seconds, not the hour the baseline would suggest.
    expect(screen.getByText(/about \d+ sec left/)).toBeTruthy();
  });

  it("falls back to step 1 when no marker has arrived yet", () => {
    renderIntl(<RunProgress startedAtMs={NOW} terminal={false} />);
    expect(screen.getByText(/Step 1 of 5/)).toBeTruthy();
    expect(percent()).toBe(0);
  });
});
