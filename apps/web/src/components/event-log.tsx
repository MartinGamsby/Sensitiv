"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { JobEvent } from "@sensitiv/shared";
import { Button, Card, Disclosure, EmptyState } from "./ui/index.ts";
import { cn } from "@/lib/cn.ts";

const MAX_RENDERED = 500;

const LEVEL_CLASS: Record<string, string> = {
  debug: "text-fg-subtle",
  info: "text-fg-muted",
  warn: "text-warn-600 dark:text-warn-400",
  error: "text-danger-600 dark:text-danger-400",
};

function formatTs(ts: string): string {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? ts : d.toLocaleTimeString();
}

export interface EventLogProps {
  events: JobEvent[];
}

/**
 * Always starts collapsed, live run or not. The progress bar in the status
 * header carries "is this thing moving", which is the only reason the log used
 * to open itself; opening it by default just buried the dossier under a wall of
 * debug lines. Opening it stays a deliberate act, and it stays open until the
 * reader closes it.
 */
export function EventLog({ events }: EventLogProps) {
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
    <Disclosure
      summary={t("title")}
      meta={total > 0 ? t("count", { count: total }) : undefined}
      contentClassName="pt-2"
    >
      <Card tone="muted" padding="none" className="overflow-hidden">
        <div className="flex items-center justify-end gap-2 border-b border-border-subtle px-3 py-1.5 sm:justify-between">
          {/* Dropped on phones: alongside the (long, in French) auto-scroll
              toggle this caption wraps the toolbar onto three lines. */}
          <span className="hidden text-[11px] uppercase tracking-wide text-fg-subtle sm:inline">
            {t("subtitle")}
          </span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setAutoScroll((v) => !v)}
            className="h-6 px-2 text-[11px]"
          >
            {autoScroll ? t("pauseScroll") : t("resumeScroll")}
          </Button>
        </div>

        <div className="max-h-80 overflow-y-auto p-3 font-mono text-xs">
          {total === 0 ? (
            <EmptyState>{t("empty")}</EmptyState>
          ) : (
            <>
              {!showAll && total > MAX_RENDERED ? (
                <button
                  type="button"
                  onClick={() => setShowAll(true)}
                  className="mb-2 block text-fg-muted underline-offset-2 hover:underline"
                >
                  {t("showAll", { count: total })}
                </button>
              ) : null}
              <ol className="flex flex-col gap-1">
                {rendered.map((event) => (
                  <li key={event.id} className="flex gap-2 leading-relaxed">
                    <span className="shrink-0 tabular-nums text-fg-subtle">
                      {formatTs(event.ts)}
                    </span>
                    <span className={cn("min-w-0 flex-1 break-words", LEVEL_CLASS[event.level])}>
                      {event.message}
                    </span>
                    {event.source ? (
                      <span className="h-fit shrink-0 rounded bg-surface px-1.5 text-[10px] uppercase tracking-wide text-fg-muted">
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
      </Card>
    </Disclosure>
  );
}
