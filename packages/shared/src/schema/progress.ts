// Run progress: the coarse phase model the run page draws its bar from.
//
// The worker tags selected `job_events` rows with a `progress` payload; the UI
// replays the stream and keeps the LAST tagged row. That keeps the bar
// deterministic — nothing here parses the free-form English of a log message,
// so rewording a log line can never move the bar.
//
// These weights are a HEURISTIC, not a measurement: they are the rough share of
// a typical run each phase takes, used only to turn a phase into a bar length.
// Being wrong here makes the bar uneven, never incorrect.
import { z } from "zod";

/** The ordered phases of `runJob`, as the run page numbers them. */
export const RUN_PHASES = ["start", "plan", "sources", "merge", "dossier"] as const;
export type RunPhase = (typeof RUN_PHASES)[number];

export const RunPhaseSchema = z.enum(RUN_PHASES);

/** What `done`/`total` are counting, so the label can name it. A small closed
 *  set rather than free text: the strings live in the message catalogue and
 *  stay translatable. */
export const PROGRESS_UNITS = ["source", "query", "place"] as const;
export type ProgressUnit = (typeof PROGRESS_UNITS)[number];

export const JobProgressSchema = z.object({
  phase: RunPhaseSchema,
  /** Units finished inside this phase, FOR THE LABEL. */
  done: z.number().int().min(0).optional(),
  /** Total units in this phase. `0` or absent means "not countable". */
  total: z.number().int().min(0).optional(),
  /** What those units are. */
  unit: z.enum(PROGRESS_UNITS).optional(),
  /**
   * Precise completion inside this phase, 0..1. When present this drives the
   * BAR and `done`/`total` only label it.
   *
   * The two have to be separable because they answer different questions. The
   * `sources` phase used to derive both from the adapter count, and 3 of its 4
   * adapters are v1.1 stubs that return nothing in under a millisecond — so the
   * bar jumped to 71% of the whole run in the first second and then sat there,
   * motionless, for the five minutes the one real adapter took. Meanwhile the
   * honest label ("place 4 of 22") counts something that changes units halfway
   * through the phase, which a bar must never do or it would run backwards.
   */
  within: z.number().min(0).max(1).optional(),
});
export type JobProgress = z.infer<typeof JobProgressSchema>;

/**
 * Share of a typical run spent in each phase. Sums to 1. `sources` dominates
 * because it is the only phase that drives a browser.
 */
const PHASE_WEIGHT: Record<RunPhase, number> = {
  start: 0.03,
  plan: 0.12,
  sources: 0.75,
  merge: 0.04,
  dossier: 0.06,
};

/** Cumulative weight of every phase BEFORE `phase`. */
function weightBefore(phase: RunPhase): number {
  let sum = 0;
  for (const p of RUN_PHASES) {
    if (p === phase) break;
    sum += PHASE_WEIGHT[p];
  }
  return sum;
}

/** 1-based position of `phase` in `RUN_PHASES`. */
export function phaseNumber(phase: RunPhase): number {
  return RUN_PHASES.indexOf(phase) + 1;
}

export const RUN_PHASE_COUNT = RUN_PHASES.length;

/**
 * Fraction of the whole run this progress marker represents, in `[0, 1)`.
 * Within a phase the sub-step count interpolates; without one the phase is
 * treated as half-done, so the bar still moves when a phase is entered.
 */
export function progressFraction(progress: JobProgress): number {
  return Math.min(
    1,
    weightBefore(progress.phase) + PHASE_WEIGHT[progress.phase] * withinFraction(progress),
  );
}

/** Completion inside the phase, 0..1. Prefers the reported `within`; falls back
 *  to the countable units; failing both, treats the phase as half-done so the
 *  bar at least moves when a phase is entered. */
function withinFraction(progress: JobProgress): number {
  if (typeof progress.within === "number") {
    return Math.min(1, Math.max(0, progress.within));
  }
  const total = progress.total ?? 0;
  if (total > 0) return Math.min(progress.done ?? 0, total) / total;
  return 0.5;
}

/**
 * Fraction of the NEXT milestone — one more sub-step, or the end of the phase
 * when there are no countable sub-steps left. The run page creeps its bar from
 * `progressFraction` toward this value between markers, so a long phase still
 * looks alive without ever overtaking work that has not happened.
 */
export function nextProgressFraction(progress: JobProgress): number {
  const total = progress.total ?? 0;
  const done = Math.min(progress.done ?? 0, total);
  const phaseEnd = Math.min(
    1,
    weightBefore(progress.phase) + PHASE_WEIGHT[progress.phase],
  );
  if (total <= 0 || done >= total) return phaseEnd;

  // One more unit's worth. With a reported `within` the step size comes from
  // the unit count but is applied to `within`, so the creep target stays
  // consistent with the bar's actual position.
  const step = 1 / total;
  const target =
    typeof progress.within === "number"
      ? Math.min(1, progress.within + step)
      : (done + 1) / total;
  return Math.min(
    phaseEnd,
    weightBefore(progress.phase) + PHASE_WEIGHT[progress.phase] * target,
  );
}

/**
 * The most recent progress marker in an event stream, with the wall-clock time
 * it was written. The timestamp is what lets the run page creep its bar between
 * markers — and it comes from the row, not from when the client happened to
 * receive it, so reopening a run mid-flight resumes at the right place.
 */
export function latestProgress(
  events: readonly { ts: string; progress?: JobProgress }[],
): { progress: JobProgress; atMs: number } | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (!event?.progress) continue;
    const atMs = Date.parse(event.ts);
    return {
      progress: event.progress,
      atMs: Number.isNaN(atMs) ? Date.now() : atMs,
    };
  }
  return undefined;
}
