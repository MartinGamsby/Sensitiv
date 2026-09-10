"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { JobEvent } from "@sensitiv/shared";

const MAX_RENDERED = 500;

const LEVEL_COLOR: Record<string, string> = {
  debug: "text-gray-400",
  info: "text-gray-700 dark:text-gray-300",
  warn: "text-amber-600 dark:text-amber-400",
  error: "text-red-600 dark:text-red-400",
};

function formatTs(ts: string): string {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? ts : d.toLocaleTimeString();
}

export function EventLog({ events }: { events: JobEvent[] }) {
  const t = useTranslations("run.log");
  const [showAll, setShowAll] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const total = events.length;
  const rendered =
    showAll || total <= MAX_RENDERED ? events : events.slice(total - MAX_RENDERED);

  useEffect(() => {
    if (autoScroll) bottomRef.current?.scrollIntoView({ block: "end" });
  }, [events, autoScroll]);

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
          {t("title")}
        </h2>
        <button
          type="button"
          onClick={() => setAutoScroll((v) => !v)}
          className="text-xs text-gray-500 hover:underline"
        >
          {autoScroll ? t("pauseScroll") : t("resumeScroll")}
        </button>
      </div>

      <div className="max-h-80 overflow-y-auto rounded border border-gray-200 bg-gray-50 p-2 font-mono text-xs dark:border-gray-800 dark:bg-gray-900">
        {total === 0 ? (
          <p className="text-gray-400">{t("empty")}</p>
        ) : (
          <>
            {!showAll && total > MAX_RENDERED ? (
              <button
                type="button"
                onClick={() => setShowAll(true)}
                className="mb-2 block text-gray-500 hover:underline"
              >
                {t("showAll", { count: total })}
              </button>
            ) : null}
            <ol className="flex flex-col gap-0.5">
              {rendered.map((event) => (
                <li key={event.id} className="flex gap-2">
                  <span className="shrink-0 text-gray-400">
                    {formatTs(event.ts)}
                  </span>
                  <span className={LEVEL_COLOR[event.level] ?? ""}>
                    {event.message}
                  </span>
                  {event.source ? (
                    <span className="shrink-0 rounded bg-gray-200 px-1 text-[10px] uppercase text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                      {event.source}
                    </span>
                  ) : null}
                </li>
              ))}
            </ol>
            <div ref={bottomRef} />
          </>
        )}
      </div>
    </section>
  );
}
