"use client";

import { useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import type { SourceMode } from "@sensitiv/shared";
import { Link } from "@/i18n/navigation.ts";

interface HistoryRow {
  id: string;
  status: string;
  requestText: string;
  location: { query: string };
  createdAt: string | number;
  finishedAt?: string | number | null;
  sourceModes?: Record<string, SourceMode>;
  placeCount?: number;
  topPlace?: { name: string; score: number; conflicted: boolean };
}

const STATUS_CLASS: Record<string, string> = {
  queued: "bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200",
  running: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  done: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200",
  partial: "bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100",
  error: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
};

const SAMPLE_DATA_CLASS =
  "bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100";
const NOT_RECORDED_CLASS =
  "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400";

/** The card's right-hand provenance badge: which sources were fixtures, or a
 *  muted note when no per-source mode was ever recorded (every run from
 *  before this change) — never a "live" claim in either case. */
function provenanceBadge(
  sourceModes: Record<string, SourceMode> | undefined,
): { kind: "sampleData" | "notRecorded"; fixtureSources: string } | null {
  const modes = sourceModes ?? {};
  const entries = Object.entries(modes);
  if (entries.length === 0) {
    return { kind: "notRecorded", fixtureSources: "" };
  }
  const fixtureSources = entries
    .filter(([, mode]) => mode === "fixture")
    .map(([source]) => source);
  if (fixtureSources.length === 0) return null;
  return { kind: "sampleData", fixtureSources: fixtureSources.join(", ") };
}

export function JobHistory() {
  const t = useTranslations("history");
  const tRun = useTranslations("run.status");
  const format = useFormatter();
  const [rows, setRows] = useState<HistoryRow[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/jobs");
        if (!res.ok) throw new Error(`GET /api/jobs ${res.status}`);
        const body = (await res.json()) as { jobs?: HistoryRow[] };
        if (!cancelled) setRows(body.jobs ?? []);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">{t("title")}</h1>

      {failed ? (
        <p className="text-sm text-red-600 dark:text-red-400">{t("empty")}</p>
      ) : rows === null ? (
        <p className="text-sm text-gray-500">{t("loading")}</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {t("empty")}{" "}
          <Link href="/" className="underline">
            {t("emptyCta")}
          </Link>
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => {
            const created = new Date(row.createdAt);
            const dateLabel = format.dateTime(created, {
              dateStyle: "short",
              timeStyle: "short",
            });
            const badge = provenanceBadge(row.sourceModes);
            const score = row.topPlace?.score;
            const scoreLabel =
              typeof score === "number"
                ? `${score >= 0 ? "+" : ""}${score}`
                : "";

            return (
              <li key={row.id}>
                <Link
                  href={`/jobs/${row.id}`}
                  className="flex items-center justify-between gap-3 rounded border border-gray-200 px-3 py-2 hover:border-gray-400 dark:border-gray-800"
                >
                  <span className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium">
                      {row.requestText || row.location.query}
                    </span>
                    <span className="text-xs text-gray-500">
                      {row.location.query} ·{" "}
                      <time dateTime={created.toISOString()} title={created.toISOString()}>
                        {dateLabel}
                      </time>
                    </span>
                    <span className="text-xs text-gray-500">
                      {row.topPlace
                        ? t("top", { name: row.topPlace.name, score: scoreLabel })
                        : t("noPlaces")}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <span
                      className={
                        "rounded px-1.5 py-0.5 text-[11px] " +
                        (STATUS_CLASS[row.status] ?? STATUS_CLASS.queued)
                      }
                    >
                      {tRun(row.status as "queued")}
                    </span>
                    {badge ? (
                      <span
                        title={
                          badge.kind === "sampleData"
                            ? t("sampleDataTitle", { sources: badge.fixtureSources })
                            : t("notRecordedTitle")
                        }
                        className={
                          "rounded px-1.5 py-0.5 text-[11px] " +
                          (badge.kind === "sampleData"
                            ? SAMPLE_DATA_CLASS
                            : NOT_RECORDED_CLASS)
                        }
                      >
                        {badge.kind === "sampleData"
                          ? t("sampleData")
                          : t("notRecorded")}
                      </span>
                    ) : null}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
