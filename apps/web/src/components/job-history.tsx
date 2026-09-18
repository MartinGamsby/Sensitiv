"use client";

import { useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import type { SourceMode } from "@sensitiv/shared";
import { Link } from "@/i18n/navigation.ts";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  SectionHeading,
  Stack,
  type BadgeTone,
} from "./ui/index.ts";
import { AlertIcon, ChevronIcon, PinIcon, TrashIcon } from "./ui/icon.tsx";
import { cn } from "@/lib/cn.ts";

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
  // `"fixture"` EXACTLY. `"stub"` (a v1.1 no-op adapter that ran and returned
  // nothing) is not sample data, and every run resolves some — counting them
  // would put this badge on every card in the list, live runs included.
  const fixtureSources = entries
    .filter(([, mode]) => mode === "fixture")
    .map(([source]) => source);
  if (fixtureSources.length === 0) return null;
  return { kind: "sampleData", fixtureSources: fixtureSources.join(", ") };
}

/** Placeholder rows while `GET /api/jobs` is in flight — same height as the
 *  real ones, so the list does not jump when they arrive. */
function HistorySkeleton() {
  return (
    <div className="flex flex-col gap-2" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="animate-pulse rounded-xl border border-border-subtle bg-surface p-4"
        >
          <div className="h-4 w-1/3 rounded bg-surface-muted" />
          <div className="mt-2.5 h-3 w-1/2 rounded bg-surface-muted" />
        </div>
      ))}
    </div>
  );
}

export function JobHistory() {
  const t = useTranslations("history");
  const tRun = useTranslations("run.status");
  const format = useFormatter();
  const [rows, setRows] = useState<HistoryRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  // Which row is asking "are you sure?", and which is mid-delete. Held here
  // rather than per row so arming one disarms any other — two live delete
  // buttons in one list is how the wrong run goes.
  const [confirming, setConfirming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function onDelete(id: string): Promise<void> {
    setDeleting(id);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/jobs/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`DELETE /api/jobs/${id} ${res.status}`);
      // Drop the row locally rather than re-fetching the list: the server has
      // already agreed it is gone, and a refetch would leave it on screen for
      // a round trip after the user confirmed.
      setRows((current) => current?.filter((row) => row.id !== id) ?? current);
      setConfirming(null);
    } catch {
      setDeleteError(id);
    } finally {
      setDeleting(null);
    }
  }

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
    <Stack as="section" gap={5}>
      <SectionHeading as="h1" description={t("description")}>
        {t("title")}
      </SectionHeading>

      {failed ? (
        <Card tone="danger" className="flex items-start gap-3">
          <AlertIcon className="mt-0.5 h-4 w-4 shrink-0 text-danger-700 dark:text-danger-300" />
          <p className="text-sm text-danger-800 dark:text-danger-200">{t("empty")}</p>
        </Card>
      ) : rows === null ? (
        <HistorySkeleton />
      ) : rows.length === 0 ? (
        <Card padding="lg" className="flex flex-col items-start gap-3">
          <EmptyState className="text-sm">{t("empty")}</EmptyState>
          <Link
            href="/"
            className="text-sm font-medium text-brand underline-offset-2 hover:underline"
          >
            {t("emptyCta")}
          </Link>
        </Card>
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

            const isConfirming = confirming === row.id;

            return (
              <li key={row.id}>
                <Card as="div" interactive padding="none">
                  <div className="flex items-stretch">
                    <Link
                      href={`/jobs/${row.id}`}
                      className="flex min-w-0 flex-1 items-center gap-4 p-4"
                    >
                      {/* `div`, not `span`: these are block elements, which are
                          invalid inside a `span` but fine inside an anchor
                          (transparent content model). */}
                      <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <span className="truncate text-sm font-semibold text-fg">
                          {row.requestText || row.location.query}
                        </span>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-muted">
                          <span className="inline-flex items-center gap-1">
                            <PinIcon className="h-3 w-3 shrink-0" />
                            {row.location.query}
                          </span>
                          <span aria-hidden="true">·</span>
                          <time
                            dateTime={created.toISOString()}
                            title={created.toISOString()}
                          >
                            {dateLabel}
                          </time>
                        </div>
                        <p
                          className={cn(
                            "truncate text-xs",
                            row.topPlace ? "text-fg" : "text-fg-subtle italic",
                          )}
                        >
                          {row.topPlace
                            ? t("top", { name: row.topPlace.name, score: scoreLabel })
                            : t("noPlaces")}
                        </p>
                      </div>

                      <div className="flex shrink-0 flex-col items-end gap-1.5">
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
                      </div>

                      <ChevronIcon className="h-4 w-4 shrink-0 text-fg-subtle" />
                    </Link>

                    {/* Outside the `Link`, never inside it: a button nested in
                        an anchor is invalid HTML and activates the anchor too,
                        which for a delete control is the worst way to fail. */}
                    <button
                      type="button"
                      onClick={() => {
                        setDeleteError(null);
                        setConfirming(isConfirming ? null : row.id);
                      }}
                      aria-expanded={isConfirming}
                      aria-label={t("delete")}
                      title={t("delete")}
                      className={cn(
                        "shrink-0 px-3 transition-colors",
                        isConfirming
                          ? "text-danger-600 dark:text-danger-400"
                          : "text-fg-subtle hover:text-danger-600 dark:hover:text-danger-400",
                      )}
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  </div>

                  {/* A second deliberate step rather than `window.confirm`:
                      it translates, it has room to say what SURVIVES the
                      delete, and a browser's "prevent additional dialogs"
                      checkbox cannot silently disable it. */}
                  {isConfirming ? (
                    <div className="flex flex-col gap-2 border-t border-border-subtle p-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-fg">
                          {t("deleteConfirm")}
                        </p>
                        <p className="mt-0.5 text-xs text-fg-muted">
                          {t("deleteConfirmNote")}
                        </p>
                        {deleteError === row.id ? (
                          <p className="mt-1 text-xs font-medium text-danger-700 dark:text-danger-300">
                            {t("deleteFailed")}
                          </p>
                        ) : null}
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setConfirming(null)}
                        >
                          {t("deleteCancel")}
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={deleting === row.id}
                          onClick={() => void onDelete(row.id)}
                          className="border-danger-300 text-danger-700 hover:border-danger-500 hover:text-danger-800 dark:border-danger-900 dark:text-danger-300 dark:hover:text-danger-200"
                        >
                          {t("deleteConfirmAction")}
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </Card>
              </li>
            );
          })}
        </Stack>
      )}
    </Stack>
  );
}
