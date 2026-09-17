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

export const JobProgressSchema = z.object({
  phase: RunPhaseSchema,
  /** Units finished inside this phase — adapters, for `sources`. */
  done: z.number().int().min(0).optional(),
  /** Total units in this phase. `0` or absent means "not countable". */
  total: z.number().int().min(0).optional(),
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
  const weight = PHASE_WEIGHT[progress.phase];
  const total = progress.total ?? 0;
  const within =
    total > 0 ? Math.min(progress.done ?? 0, total) / total : 0.5;
  return Math.min(1, weightBefore(progress.phase) + weight * within);
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
  if (total > 0 && done < total) {
    return progressFraction({ ...progress, done: done + 1 });
  }
  return Math.min(
    1,
    weightBefore(progress.phase) + PHASE_WEIGHT[progress.phase],
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
