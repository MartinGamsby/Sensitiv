// Time estimates for the run page — deliberately a HEURISTIC, and labelled as
// one in the UI ("about 2 min left"). Nothing downstream depends on it being
// right; its job is to tell the user the run is alive and roughly how far in.
//
// Two independent signals are blended:
//   - how long this user's recent runs actually took (`baselineMs`), and
//   - how long THIS run has taken to reach the fraction it has (`elapsed / f`).
// Early on the second signal is noise, so it only joins once the run has
// visible progress to extrapolate from.

/** Used when the user has no finished runs yet to average over. */
export const DEFAULT_BASELINE_MS = 120_000;

/** Below this, `elapsed / fraction` extrapolates from too little to mean anything. */
const MIN_EXTRAPOLATION_FRACTION = 0.05;

/** Median, so one timed-out run does not drag the whole baseline up. */
export function medianMs(samples: readonly number[]): number | undefined {
  const sorted = [...samples].filter((n) => n > 0).sort((a, b) => a - b);
  if (sorted.length === 0) return undefined;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : ((sorted[mid - 1]! + sorted[mid]!) / 2);
}

export interface RunEstimateInput {
  /** Progress so far, 0–1, from the phase markers. */
  fraction: number;
  elapsedMs: number;
  /** Median of this user's recent finished runs; absent when they have none. */
  baselineMs?: number;
  /** The job's own budget. The run cannot outlast it, so neither can the guess. */
  timeoutMs?: number;
}

export interface RunEstimate {
  /** Best guess at the run's total wall-clock time. */
  totalMs: number;
  /** Never negative, and `0` means "should be finishing now", not "finished". */
  remainingMs: number;
  /**
   * The run has already outlived its own budget.
   *
   * Worth its own flag because the two readings it used to collapse into mean
   * opposite things. `remainingMs === 0` was showing "finishing up" next to a
   * bar at 60% — the estimate had been clamped to the budget, elapsed had
   * passed it, and the subtraction bottomed out. The run was not finishing up;
   * it was late, which is the one thing the user most wants to be told.
   */
  overBudget: boolean;
}

export function estimateRun({
  fraction,
  elapsedMs,
  baselineMs,
  timeoutMs,
}: RunEstimateInput): RunEstimate {
  const baseline = baselineMs && baselineMs > 0 ? baselineMs : DEFAULT_BASELINE_MS;
  const projected =
    fraction >= MIN_EXTRAPOLATION_FRACTION ? elapsedMs / fraction : undefined;

  // Equal weight once both signals exist: the baseline knows what runs cost in
  // general, this run knows what today's network and sources cost.
  let totalMs = projected === undefined ? baseline : (projected + baseline) / 2;

  // The budget is a hard stop in the runner, so never promise past it.
  if (timeoutMs && timeoutMs > 0) totalMs = Math.min(totalMs, timeoutMs);
  // The timeout check is between steps, not preemptive, so a run CAN outlive
  // its budget — a single slow page load or extraction is uninterruptible.
  const overBudget = Boolean(timeoutMs && timeoutMs > 0 && elapsedMs > timeoutMs);
  totalMs = Math.max(totalMs, elapsedMs);

  return { totalMs, remainingMs: Math.max(0, totalMs - elapsedMs), overBudget };
}

/**
 * `m:ss` for a stopwatch reading — the elapsed side, where the exact number is
 * real and worth showing.
 */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/**
 * Rounded, unit-bearing buckets for the ESTIMATED side — "about 2 min", never
 * "about 1:47", which reads far more precise than this number is. Returns the
 * number and the unit separately so the caller can localise the wording.
 */
export function roundRemaining(ms: number): { value: number; unit: "sec" | "min" } {
  const seconds = Math.max(0, ms / 1000);
  if (seconds < 90) {
    // 10s buckets, never rounded down to a zero that reads as "finished".
    return { value: Math.max(10, Math.round(seconds / 10) * 10), unit: "sec" };
  }
  return { value: Math.max(2, Math.round(seconds / 60)), unit: "min" };
}
