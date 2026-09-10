"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation.ts";

interface HistoryRow {
  id: string;
  status: string;
  requestText: string;
  location: { query: string };
  createdAt: string | number;
}

const STATUS_CLASS: Record<string, string> = {
  queued: "bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200",
  running: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  done: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200",
  partial: "bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100",
  error: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
};

export function JobHistory() {
  const t = useTranslations("history");
  const tRun = useTranslations("run.status");
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
          {rows.map((row) => (
            <li key={row.id}>
              <Link
                href={`/jobs/${row.id}`}
                className="flex items-center justify-between gap-3 rounded border border-gray-200 px-3 py-2 hover:border-gray-400 dark:border-gray-800"
              >
                <span className="flex flex-col">
                  <span className="text-sm font-medium">
                    {row.requestText || row.location.query}
                  </span>
                  <span className="text-xs text-gray-500">
                    {row.location.query}
                  </span>
                </span>
                <span
                  className={
                    "shrink-0 rounded px-1.5 py-0.5 text-[11px] " +
                    (STATUS_CLASS[row.status] ?? STATUS_CLASS.queued)
                  }
                >
                  {tRun(row.status as "queued")}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
