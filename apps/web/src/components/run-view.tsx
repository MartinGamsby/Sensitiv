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

const TERMINAL = new Set(["done", "partial", "error"]);

const BANNER_CLASS: Record<string, string> = {
  connecting: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-200",
  queued: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-200",
  running: "bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-100",
  done: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100",
  partial: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-100",
  error: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-100",
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
    <section className="flex flex-col gap-5">
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
        <div
          key={code}
          className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100"
          role="alert"
        >
          <span className="font-medium">
            {t(`notice.${NOTICE_KEY[code]}.title`)}
          </span>{" "}
          <span>{t(`notice.${NOTICE_KEY[code]}.body`)}</span>
        </div>
      ))}

      <div className="flex flex-col-reverse gap-6 lg:flex-col">
        <EventLog events={events} />
        {dossier ? <Dossier dossier={dossier} /> : null}
      </div>
    </section>
  );
}
