"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  RUN_PHASE_COUNT,
  nextProgressFraction,
  phaseNumber,
  progressFraction,
  type JobProgress,
} from "@sensitiv/shared";
import {
  estimateRun,
  formatElapsed,
  roundRemaining,
} from "@/lib/run-estimate.ts";
import { cn } from "@/lib/cn.ts";

/** How often the elapsed clock and the creep redraw. */
const TICK_MS = 1_000;

/**
 * The bar stops here while the run is live. A full bar next to a spinner reads
 * as "finished, and stuck" — the last sliver belongs to the terminal state.
 */
const LIVE_CEILING = 0.97;

/** Floor on the creep time-constant, so a fast phase does not snap instantly. */
const MIN_TAU_MS = 5_000;

/**
 * Where the bar sits between two markers: an exponential approach from the
 * marker's fraction toward the next milestone. It never arrives, so the bar
 * cannot claim work that has not been reported — it just keeps moving, which
 * is the whole point of showing it.
 */
export function creepFraction(
  base: number,
  next: number,
  sinceMarkerMs: number,
  totalEstimateMs: number,
): number {
  const span = next - base;
  if (span <= 0) return base;
  // Expected time to cover this span, discounted so the bar tends to run a
  // little ahead of schedule rather than stalling short of every milestone.
  const tau = Math.max(MIN_TAU_MS, totalEstimateMs * span * 0.6);
  return base + span * (1 - Math.exp(-Math.max(0, sinceMarkerMs) / tau));
}

export interface RunProgressProps {
  progress?: { progress: JobProgress; atMs: number };
  /** When the run started. Absent while it is still queued. */
  startedAtMs?: number;
  /** Median of this user's recent finished runs, for the ETA. */
  baselineMs?: number;
  /** The job's time budget — the ETA never promises past it. */
  timeoutMs?: number;
  terminal: boolean;
  /** Set once the run has finished; turns the ETA line into a final duration. */
  finishedAtMs?: number;
  className?: string;
}

export function RunProgress({
  progress,
  startedAtMs,
  baselineMs,
  timeoutMs,
  terminal,
  finishedAtMs,
  className,
}: RunProgressProps) {
  const t = useTranslations("run.progress");
  const [now, setNow] = useState(() => Date.now());
  // The bar only ever moves forward. Without this, a marker that lands while
  // the creep has run ahead of it would visibly snap backwards.
  const highWater = useRef(0);

  useEffect(() => {
    if (terminal) return;
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, [terminal]);

  const elapsedMs = Math.max(
    0,
    (terminal && finishedAtMs ? finishedAtMs : now) - (startedAtMs ?? now),
  );

  const marker = progress?.progress;
  const base = marker ? progressFraction(marker) : 0;
  const { totalMs, remainingMs } = estimateRun({
    fraction: base,
    elapsedMs,
    baselineMs,
    timeoutMs,
  });

  let fraction = terminal
    ? 1
    : creepFraction(
        base,
        marker ? nextProgressFraction(marker) : LIVE_CEILING,
        now - (progress?.atMs ?? now),
        totalMs,
      );
  if (!terminal) fraction = Math.min(fraction, LIVE_CEILING);
  highWater.current = terminal ? 1 : Math.max(highWater.current, fraction);
  fraction = highWater.current;

  const percent = Math.round(fraction * 100);
  const step = marker ? phaseNumber(marker.phase) : 1;
  const phaseLabel = marker ? t(`phase.${marker.phase}`) : t("phase.start");
  // Sub-steps are only worth naming when there is more than one of them. The
  // unit changes partway through a phase — searches first, then the places
  // those searches turned up — which is exactly why it is labelled separately
  // from the bar's own position.
  const sub =
    marker && (marker.total ?? 0) > 1
      ? t(`within.${marker.unit ?? "source"}`, {
          done: Math.min(marker.done ?? 0, marker.total ?? 0),
          total: marker.total ?? 0,
        })
      : undefined;

  const remaining = roundRemaining(remainingMs);
  const timing = terminal
    ? t("took", { elapsed: formatElapsed(elapsedMs) })
    : remainingMs <= 0
      ? t("almostDone", { elapsed: formatElapsed(elapsedMs) })
      : t(remaining.unit === "min" ? "remainingMin" : "remainingSec", {
          elapsed: formatElapsed(elapsedMs),
          value: remaining.value,
        });

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-xs text-fg-muted">
        <span className="font-medium">
          {terminal
            ? t("complete")
            : t("step", { step, total: RUN_PHASE_COUNT, phase: phaseLabel })}
          {sub ? <span className="font-normal text-fg-subtle"> · {sub}</span> : null}
        </span>
        <span className="tabular-nums text-fg-subtle">{timing}</span>
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-label={t("label")}
        className="h-1.5 w-full overflow-hidden rounded-full bg-border-subtle"
      >
        <div
          className="h-full rounded-full bg-brand transition-[width] duration-1000 ease-linear"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
