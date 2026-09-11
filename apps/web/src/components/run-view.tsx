"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  DossierSchema,
  type Dossier as DossierData,
  type JobEvent,
} from "@sensitiv/shared";
import { useJobEvents } from "@/hooks/use-job-events.ts";
import { Link } from "@/i18n/navigation.ts";
import { EventLog } from "./event-log.tsx";
import { Dossier } from "./dossier.tsx";
import { Card, Stack } from "./ui/index.ts";

const TERMINAL = new Set(["done", "partial", "error"]);

// Same tone families `Badge`/`Card` use (`tailwind.config.ts`), spelled out
// here because the status banner needs its own shade combination (a solid
// full-width strip, not a pill) — one lookup instead of one per file.
const BANNER_CLASS: Record<string, string> = {
  connecting: "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200",
  queued: "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200",
  running: "bg-info-100 text-info-900 dark:bg-info-950 dark:text-info-100",
  done: "bg-ok-100 text-ok-900 dark:bg-ok-950 dark:text-ok-100",
  partial: "bg-warn-100 text-warn-900 dark:bg-warn-950 dark:text-warn-100",
  error: "bg-danger-100 text-danger-900 dark:bg-danger-950 dark:text-danger-100",
};

const NOTE_KEY: Record<string, string> = {
  queued: "status.queuedNote",
  running: "status.runningNote",
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

export function RunView({ jobId }: { jobId: string }) {
  const t = useTranslations("run");
  const { events, status } = useJobEvents(jobId);
  const [dossier, setDossier] = useState<DossierData | null>(null);

  const terminal = TERMINAL.has(status);

  useEffect(() => {
    if (!terminal) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`);
        if (!res.ok) return;
        const parsed = DossierSchema.safeParse(await res.json());
        if (!cancelled && parsed.success) setDossier(parsed.data);
      } catch {
        /* leave the dossier unset; the event log still stands */
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

  return (
    <Stack as="section" gap={5}>
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{t("title")}</h1>
        <Link href="/" className="text-sm text-gray-500 hover:underline">
          {t("backToForm")}
        </Link>
      </div>

      <div
        className={
          "rounded px-3 py-2 text-sm " +
          (BANNER_CLASS[status] ?? BANNER_CLASS.connecting)
        }
        role="status"
      >
        <span className="font-medium">{t(statusLabelKey)}</span>
        {noteKey ? <span className="ml-2">{t(noteKey)}</span> : null}
      </div>

      {notices.map((code) => (
        <Card
          key={code}
          tone="warn"
          role="alert"
          className="rounded border-warn-300 bg-warn-50 px-3 py-2 text-sm text-warn-900 dark:border-warn-800 dark:bg-warn-950 dark:text-warn-100"
        >
          <span className="font-medium">
            {t(`notice.${NOTICE_KEY[code]}.title`)}
          </span>{" "}
          <span>{t(`notice.${NOTICE_KEY[code]}.body`)}</span>
        </Card>
      ))}

      <div className="flex flex-col-reverse gap-6 lg:flex-col">
        <EventLog events={events} />
        {dossier ? <Dossier dossier={dossier} /> : null}
      </div>
    </Stack>
  );
}
