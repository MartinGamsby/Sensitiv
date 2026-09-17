"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import {
  DossierSchema,
  latestProgress,
  type Dossier as DossierData,
  type JobEvent,
} from "@sensitiv/shared";
import { useJobEvents } from "@/hooks/use-job-events.ts";
import { Link } from "@/i18n/navigation.ts";
import { EventLog } from "./event-log.tsx";
import { RunProgress } from "./run-progress.tsx";
import { Dossier } from "./dossier.tsx";
import { Card, LiveDot, Stack } from "./ui/index.ts";
import { AlertIcon, CheckIcon, ClockIcon, InfoIcon, SearchIcon } from "./ui/icon.tsx";
import { cn } from "@/lib/cn.ts";

const TERMINAL = new Set(["done", "partial", "error"]);

// One lookup for the status header's surface, accent and glyph, instead of the
// three parallel records (banner class, note key, icon) this used to grow.
const STATUS_STYLE: Record<
  string,
  { card: string; accent: string; icon: "clock" | "live" | "check" | "alert" }
> = {
  connecting: { card: "border-border-subtle bg-surface", accent: "text-fg-muted", icon: "clock" },
  queued: { card: "border-border-subtle bg-surface", accent: "text-fg-muted", icon: "clock" },
  running: {
    card: "border-info-200 bg-info-50 dark:border-info-900/70 dark:bg-info-950/50",
    accent: "text-info-700 dark:text-info-300",
    icon: "live",
  },
  done: {
    card: "border-ok-200 bg-ok-50 dark:border-ok-900/70 dark:bg-ok-950/50",
    accent: "text-ok-700 dark:text-ok-300",
    icon: "check",
  },
  partial: {
    card: "border-warn-300 bg-warn-50 dark:border-warn-900/70 dark:bg-warn-950/50",
    accent: "text-warn-800 dark:text-warn-200",
    icon: "alert",
  },
  error: {
    card: "border-danger-300 bg-danger-50 dark:border-danger-900/70 dark:bg-danger-950/50",
    accent: "text-danger-700 dark:text-danger-300",
    icon: "alert",
  },
};

const NOTE_KEY: Record<string, string> = {
  queued: "status.queuedNote",
  running: "status.runningNote",
  done: "status.doneNote",
  partial: "status.partialNote",
  error: "status.errorNote",
};

// `job_events.source` values the worker sets when it degrades — mapped to their
// message keys under `run.notice.*`. Order here is the display order.
const NOTICE_KEY: Record<string, string> = {
  "degraded-llm": "degradedLlm",
  "degraded-solari": "degradedSolari",
  "solari-skipped-no-llm": "solariSkippedNoLlm",
};

/** The distinct degradation notices present in this run's event stream. */
export function deriveNotices(events: JobEvent[]): string[] {
  const seen = new Set<string>();
  for (const e of events) {
    if (e.source && e.source in NOTICE_KEY) seen.add(e.source);
  }
  return Object.keys(NOTICE_KEY).filter((code) => seen.has(code));
}

function StatusGlyph({ kind, className }: { kind: string; className?: string }) {
  if (kind === "live") return <LiveDot className={cn("mt-1.5", className)} />;
  if (kind === "check") return <CheckIcon className={cn("h-5 w-5", className)} />;
  if (kind === "alert") return <AlertIcon className={cn("h-5 w-5", className)} />;
  return <ClockIcon className={cn("h-5 w-5", className)} />;
}

/** The three grey bars standing in for a dossier that has not arrived yet. */
function ResultsPlaceholder({ label }: { label: ReactNode }) {
  return (
    <Card padding="lg" className="flex flex-col gap-4">
      <p className="flex items-center gap-2 text-sm font-medium text-fg-muted">
        <SearchIcon className="h-4 w-4" />
        {label}
      </p>
      <div className="flex flex-col gap-3" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="animate-pulse rounded-xl border border-border-subtle bg-surface-muted p-4"
          >
            <div className="h-4 w-1/3 rounded bg-border-subtle" />
            <div className="mt-3 h-3 w-2/3 rounded bg-border-subtle" />
            <div className="mt-2 h-3 w-1/2 rounded bg-border-subtle" />
          </div>
        ))}
      </div>
    </Card>
  );
}

export interface RunViewProps {
  jobId: string;
  /** From the server pass on the run page — see `jobs/[id]/page.tsx`. */
  startedAtMs?: number;
  timeoutMs?: number;
  baselineMs?: number;
}

export function RunView({
  jobId,
  startedAtMs,
  timeoutMs,
  baselineMs,
}: RunViewProps) {
  const t = useTranslations("run");
  const { events, status } = useJobEvents(jobId);
  const [dossier, setDossier] = useState<DossierData | null>(null);
  // Distinguishes "the dossier is still on its way" from "it is not coming".
  // Without it a finished run whose dossier fails to load renders as the word
  // "Done" above an empty page.
  const [dossierFailed, setDossierFailed] = useState(false);

  const terminal = TERMINAL.has(status);

  useEffect(() => {
    if (!terminal) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`);
        if (!res.ok) throw new Error(`GET /api/jobs/:id ${res.status}`);
        const parsed = DossierSchema.safeParse(await res.json());
        if (cancelled) return;
        if (parsed.success) setDossier(parsed.data);
        else setDossierFailed(true);
      } catch {
        // Leave the dossier unset and say so; the event log still stands.
        if (!cancelled) setDossierFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [terminal, jobId]);

  const statusLabelKey =
    status === "connecting" ? "status.queued" : `status.${status}`;
  const noteKey = NOTE_KEY[status];
  const notices = deriveNotices(events);
  const style = STATUS_STYLE[status] ?? STATUS_STYLE.connecting!;

  // While the run is live, the newest log line doubles as a progress read-out
  // so the header says what is happening without the log being open.
  const latest = terminal ? undefined : events.at(-1)?.message;

  // The server knows `started_at` only for a job that was already running when
  // the page rendered. For one that was still queued, the first event to arrive
  // is the run's own start — close enough, and it needs no extra round trip.
  const firstEventMs = events[0] ? Date.parse(events[0].ts) : Number.NaN;
  const runStartMs =
    startedAtMs ?? (Number.isNaN(firstEventMs) ? undefined : firstEventMs);
  // Likewise the finish: the runner appends its closing row BEFORE flipping the
  // status, so on a terminal stream the last row's timestamp IS the end.
  const lastEventMs = events.at(-1) ? Date.parse(events.at(-1)!.ts) : Number.NaN;
  const finishedAtMs =
    terminal && !Number.isNaN(lastEventMs) ? lastEventMs : undefined;
  const progress = latestProgress(events);

  return (
    <Stack as="section" gap={6}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-fg">
          {t("title")}
        </h1>
        <Link
          href="/"
          className="whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium text-fg-muted transition-colors hover:bg-surface-muted hover:text-fg"
        >
          {t("backToForm")}
        </Link>
      </div>

      <div
        role="status"
        className={cn("flex items-start gap-3 rounded-xl border p-4", style.card)}
      >
        <StatusGlyph kind={style.icon} className={cn("shrink-0", style.accent)} />
        <div className="min-w-0 flex-1">
          <p className={cn("text-sm font-semibold", style.accent)}>
            {t(statusLabelKey)}
          </p>
          {noteKey ? (
            <p className="mt-0.5 text-sm leading-relaxed text-fg-muted">
              {t(noteKey)}
            </p>
          ) : null}
          {status === "connecting" ? null : (
            <RunProgress
              className="mt-3"
              progress={progress}
              startedAtMs={runStartMs}
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
      </div>

      {notices.map((code) => (
        <Card key={code} tone="warn" role="alert" className="flex items-start gap-3">
          <AlertIcon className="mt-0.5 h-4 w-4 shrink-0 text-warn-700 dark:text-warn-300" />
          <p className="text-sm leading-relaxed text-warn-900 dark:text-warn-100">
            <span className="font-semibold">
              {t(`notice.${NOTICE_KEY[code]}.title`)}
            </span>{" "}
            <span>{t(`notice.${NOTICE_KEY[code]}.body`)}</span>
          </p>
        </Card>
      ))}

      {/* Results first. The log is the supporting detail, not the headline —
          it used to render above the dossier on wide screens. */}
      {dossier ? (
        <Dossier dossier={dossier} />
      ) : dossierFailed ? (
        <Card tone="muted" padding="lg" className="flex items-start gap-3">
          <InfoIcon className="mt-0.5 h-4 w-4 shrink-0 text-fg-subtle" />
          <p className="text-sm leading-relaxed text-fg-muted">
            {t("dossierUnavailable")}
          </p>
        </Card>
      ) : (
        <ResultsPlaceholder label={t("working")} />
      )}

      <EventLog events={events} />
    </Stack>
  );
}
