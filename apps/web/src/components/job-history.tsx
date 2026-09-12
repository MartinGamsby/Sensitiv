"use client";

import { useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import type { SourceMode } from "@sensitiv/shared";
import { Link } from "@/i18n/navigation.ts";
import { Badge, Card, EmptyState, MetaRow, Stack, type BadgeTone } from "./ui/index.ts";

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

const STATUS_TONE: Record<string, BadgeTone> = {
  queued: "neutral",
  running: "info",
  done: "ok",
  partial: "warn",
  error: "danger",
};

function statusTone(status: string): BadgeTone {
  return STATUS_TONE[status] ?? "neutral";
}

/** A run that has not reached a terminal state yet has nothing to say about
 *  its provenance — the worker writes `source_modes_json` once, just before
 *  `finishJob`. */
const TERMINAL_STATUSES = new Set(["done", "partial", "error"]);

/** The card's right-hand provenance badge: which sources were fixtures, or a
 *  muted note when no per-source mode was ever recorded (every run from
 *  before this change) — never a "live" claim in either case. */
function provenanceBadge(
  sourceModes: Record<string, SourceMode> | undefined,
  status: string,
): { kind: "sampleData" | "notRecorded"; fixtureSources: string } | null {
  const modes = sourceModes ?? {};
  const entries = Object.entries(modes);
  if (entries.length === 0) {
    // "This run predates provenance tracking" is a claim about the past, and
    // it is false for a run that is still queued or running — its modes have
    // simply not been written yet. Say nothing rather than something wrong.
    return TERMINAL_STATUSES.has(status)
      ? { kind: "notRecorded", fixtureSources: "" }
      : null;
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
    <Stack as="section" gap={4}>
      <h1 className="text-xl font-semibold">{t("title")}</h1>

      {failed ? (
        <p className="text-sm text-red-600 dark:text-red-400">{t("empty")}</p>
      ) : rows === null ? (
        <p className="text-sm text-gray-500">{t("loading")}</p>
      ) : rows.length === 0 ? (
        <EmptyState
          className="text-sm"
          action={
            <Link href="/" className="underline">
              {t("emptyCta")}
            </Link>
          }
        >
          {t("empty")}{" "}
        </EmptyState>
      ) : (
        <Stack as="ul" gap={2}>
          {rows.map((row) => {
            const created = new Date(row.createdAt);
            const dateLabel = format.dateTime(created, {
              dateStyle: "short",
              timeStyle: "short",
            });
            const badge = provenanceBadge(row.sourceModes, row.status);
            const score = row.topPlace?.score;
            const scoreLabel =
              typeof score === "number"
                ? `${score >= 0 ? "+" : ""}${score}`
                : "";

            return (
              <li key={row.id}>
                <Card as="div" interactive className="p-0">
                  <Link
                    href={`/jobs/${row.id}`}
                    className="flex items-center justify-between gap-3 px-3 py-2"
                  >
                    {/* `div`, not `span`: `MetaRow` renders a block element,
                        which is invalid inside a `span` but fine inside an
                        anchor (transparent content model). */}
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="text-sm font-medium">
                        {row.requestText || row.location.query}
                      </span>
                      <MetaRow
                        value={
                          <>
                            {row.location.query} ·{" "}
                            <time
                              dateTime={created.toISOString()}
                              title={created.toISOString()}
                            >
                              {dateLabel}
                            </time>
                          </>
                        }
                      />
                      <MetaRow
                        value={
                          row.topPlace
                            ? t("top", { name: row.topPlace.name, score: scoreLabel })
                            : t("noPlaces")
                        }
                      />
                    </div>
                    <Stack as="span" gap={1} className="shrink-0 items-end">
                      <Badge tone={statusTone(row.status)}>
                        {tRun(row.status as "queued")}
                      </Badge>
                      {badge ? (
                        <Badge
                          tone={badge.kind === "sampleData" ? "warn" : "neutral"}
                          title={
                            badge.kind === "sampleData"
                              ? t("sampleDataTitle", { sources: badge.fixtureSources })
                              : t("notRecordedTitle")
                          }
                        >
                          {badge.kind === "sampleData"
                            ? t("sampleData")
                            : t("notRecorded")}
                        </Badge>
                      ) : null}
                    </Stack>
                  </Link>
                </Card>
              </li>
            );
          })}
        </Stack>
      )}
    </Stack>
  );
}
