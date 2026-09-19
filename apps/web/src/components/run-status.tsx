"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { JobProgress } from "@sensitiv/shared";
import { RunProgress } from "./run-progress.tsx";
import { ChevronIcon } from "./ui/icon.tsx";
import { formatElapsed } from "@/lib/run-estimate.ts";
import { cn } from "@/lib/cn.ts";

/**
 * How long a finished run's progress card stays open before folding itself
 * away.
 *
 * Long enough to read "Done" and see the bar reach the end — that moment is
 * the answer to "did it work", and snapping it shut instantly would throw
 * away the only feedback the reader was waiting for. Short enough that the
 * results are not sharing the screen with a finished progress bar for long.
 */
export const AUTO_COLLAPSE_MS = 4000;

/**
 * Statuses that fold themselves away.
 *
 * `done` only. A `partial` run stopped at its time limit and an `error` run
 * did not finish — for both, this card holds the only explanation of why the
 * dossier looks the way it does, and hiding that after four seconds would be
 * hiding the thing the reader most needs. They stay open, and stay manually
 * collapsible like everything else.
 */
const SELF_COLLAPSING = new Set(["done"]);

export interface RunStatusProps {
  /** Live status from the SSE stream (`connecting` until the first frame). */
  status: string;
  terminal: boolean;
  /**
   * The status the SERVER saw when it rendered the page.
   *
   * This is what tells a finished run apart from one that finishes while the
   * reader watches. Without it every reopened run would play the
   * open-then-collapse animation on load, which is theatre about something
   * that happened days ago.
   */
  initialStatus?: string;
  statusLabel: ReactNode;
  note?: ReactNode;
  /** Newest log line, shown while the run is live. */
  latest?: string;
  accentClass: string;
  cardClass: string;
  glyph: ReactNode;
  /** Same shape `RunProgress` takes: the marker plus when it landed. */
  progress?: { progress: JobProgress; atMs: number };
  startedAtMs?: number;
  baselineMs?: number;
  timeoutMs?: number;
  finishedAtMs?: number;
}

/**
 * The run's status header, which folds itself away once the run is done.
 *
 * A progress bar is the most important thing on the page right up to the
 * moment it fills, and clutter immediately after. So: a run that was already
 * finished when the page loaded renders collapsed with no animation, a run
 * that finishes while you watch stays open for `AUTO_COLLAPSE_MS` and then
 * folds, and either way the reader can open it again.
 *
 * Opening it by hand is final — it never re-collapses. A control that undoes
 * what the reader just did is worse than no automation at all.
 */
export function RunStatus({
  status,
  terminal,
  initialStatus,
  statusLabel,
  note,
  latest,
  accentClass,
  cardClass,
  glyph,
  progress,
  startedAtMs,
  baselineMs,
  timeoutMs,
  finishedAtMs,
}: RunStatusProps) {
  const t = useTranslations("run");
  // `useState(initialiser)` so this is read once, from the FIRST render's
  // props — the point is what the server saw, not what the stream says now.
  const [startedFinished] = useState(
    () => initialStatus !== undefined && SELF_COLLAPSING.has(initialStatus),
  );
  const [open, setOpen] = useState(!startedFinished);
  // Set the moment the card folds on its own, or the moment the reader
  // touches it. Either way the automation is done for this page load.
  const settled = useRef(startedFinished);

  useEffect(() => {
    if (settled.current || !terminal || !SELF_COLLAPSING.has(status)) return;
    const id = setTimeout(() => {
      // Re-check: the reader may have collapsed or expanded it in the
      // meantime, and their choice wins over the timer.
      if (settled.current) return;
      settled.current = true;
      setOpen(false);
    }, AUTO_COLLAPSE_MS);
    return () => clearTimeout(id);
  }, [terminal, status]);

  const elapsed =
    terminal && finishedAtMs !== undefined && startedAtMs !== undefined
      ? formatElapsed(finishedAtMs - startedAtMs)
      : undefined;

  return (
    <div
      role="status"
      data-testid="run-status"
      data-open={open ? "true" : "false"}
      className={cn("rounded-xl border", cardClass)}
    >
      <button
        type="button"
        onClick={() => {
          settled.current = true;
          setOpen((wasOpen) => !wasOpen);
        }}
        aria-expanded={open}
        aria-label={t("statusDetails")}
        className={cn(
          "flex w-full items-start gap-3 rounded-xl text-left",
          // Tighter when folded: the whole point is to give the room back.
          open ? "p-4 pb-2" : "px-4 py-2.5",
        )}
      >
        <span className={cn("shrink-0", accentClass)}>{glyph}</span>
        <span className="min-w-0 flex-1">
          <span className={cn("block text-sm font-semibold", accentClass)}>
            {statusLabel}
            {/* Folded, the duration is the one detail worth keeping on
                screen — it is the whole of what the bar was saying. */}
            {!open && elapsed ? (
              <span className="font-normal text-fg-muted">
                {" · "}
                {t("progress.took", { elapsed })}
              </span>
            ) : null}
          </span>
          {open && note ? (
            <span className="mt-0.5 block text-sm leading-relaxed text-fg-muted">
              {note}
            </span>
          ) : null}
        </span>
        <ChevronIcon
          aria-hidden="true"
          className={cn(
            "h-4 w-4 shrink-0 text-fg-subtle transition-transform",
            open && "rotate-90",
          )}
        />
      </button>

      {open ? (
        <div className="px-4 pb-4 pl-12">
          {status === "connecting" ? null : (
            <RunProgress
              progress={progress}
              startedAtMs={startedAtMs}
              baselineMs={baselineMs}
              timeoutMs={timeoutMs}
              terminal={terminal}
              finishedAtMs={finishedAtMs}
            />
          )}
          {latest ? (
            <p className="mt-2 truncate font-mono text-xs text-fg-subtle" title={latest}>
              {latest}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
