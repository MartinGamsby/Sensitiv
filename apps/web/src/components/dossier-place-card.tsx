"use client";

import { useLocale, useTranslations } from "next-intl";
import { getRequirement, labelOf } from "@sensitiv/shared/catalog/index";
import type { DossierPlace, Evidence, UiLocale } from "@sensitiv/shared";

export type Consensus = "agreed" | "conflicted" | "single";

/**
 * Per-requirement consensus across sources:
 *  - `conflicted` when at least one source supports AND at least one contradicts;
 *  - `single` when only one distinct source spoke to it;
 *  - `agreed` otherwise.
 * Conflicted is NEVER hidden and renders amber.
 */
export function consensusFor(evidence: Evidence[]): Consensus {
  const supports = evidence.some((e) => e.polarity === "supports");
  const contradicts = evidence.some((e) => e.polarity === "contradicts");
  if (supports && contradicts) return "conflicted";
  const sources = new Set(evidence.map((e) => e.source));
  if (sources.size <= 1) return "single";
  return "agreed";
}

export function groupByRequirement(
  evidence: Evidence[],
): Array<{ requirementId: string; evidence: Evidence[] }> {
  const order: string[] = [];
  const map = new Map<string, Evidence[]>();
  for (const e of evidence) {
    if (!map.has(e.requirementId)) {
      map.set(e.requirementId, []);
      order.push(e.requirementId);
    }
    map.get(e.requirementId)!.push(e);
  }
  return order.map((requirementId) => ({
    requirementId,
    evidence: map.get(requirementId)!,
  }));
}

const CONSENSUS_CLASS: Record<Consensus, string> = {
  agreed:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200",
  conflicted:
    "bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100",
  single: "bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200",
};

export interface DossierPlaceCardProps {
  entry: DossierPlace;
  uiLocale: UiLocale;
  /** BCP-47 code the searches ran in; drives the quote translation line. */
  searchLang: string;
}

export function DossierPlaceCard({
  entry,
  uiLocale,
  searchLang,
}: DossierPlaceCardProps) {
  const t = useTranslations("dossier");
  const locale = useLocale() as UiLocale;
  const groups = groupByRequirement(entry.evidence);
  const anyConflict =
    entry.conflicted || groups.some((g) => consensusFor(g.evidence) === "conflicted");
  const showTranslation =
    searchLang.slice(0, 2).toLowerCase() !== uiLocale;

  const redFlags = entry.evidence.filter((e) => e.polarity === "contradicts");

  return (
    <article
      data-conflicted={anyConflict ? "true" : "false"}
      className={
        "flex flex-col gap-3 rounded-lg border p-4 " +
        (anyConflict
          ? "border-amber-400 bg-amber-50 dark:bg-amber-950/40"
          : "border-gray-200 dark:border-gray-800")
      }
    >
      <header className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">{entry.place.name}</h3>
          {entry.place.address ? (
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {entry.place.address}
            </p>
          ) : null}
          {entry.place.category ? (
            <p className="text-xs uppercase tracking-wide text-gray-400">
              {entry.place.category}
            </p>
          ) : null}
        </div>
        <span className="shrink-0 rounded bg-gray-900 px-2 py-1 text-xs font-medium text-white dark:bg-gray-100 dark:text-gray-900">
          {t("place.score", { score: entry.score })}
        </span>
      </header>

      {entry.sources.length > 0 ? (
        <ul className="flex flex-wrap gap-2 text-xs text-gray-600 dark:text-gray-400">
          {entry.sources.map((s, i) => (
            <li
              key={`${s.source}-${i}`}
              className="rounded border border-gray-200 px-2 py-0.5 dark:border-gray-700"
            >
              {s.source}
              {typeof s.rating === "number"
                ? ` · ${t("place.rating", { rating: s.rating })}`
                : ""}
              {typeof s.reviewCount === "number"
                ? ` · ${t("place.reviews", { count: s.reviewCount })}`
                : ""}
            </li>
          ))}
        </ul>
      ) : null}

      {groups.length > 0 ? (
        <div className="flex flex-col gap-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            {t("place.requirementMatch")}
          </p>
          {groups.map((g) => {
            const consensus = consensusFor(g.evidence);
            const reqLabel =
              labelOf(getRequirement(g.requirementId), locale) ||
              g.requirementId;
            return (
              <div key={g.requirementId} className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{reqLabel}</span>
                  <span
                    className={
                      "rounded px-1.5 py-0.5 text-[11px] " +
                      CONSENSUS_CLASS[consensus]
                    }
                  >
                    {t(`consensus.${consensus}`)}
                  </span>
                </div>
                {consensus === "conflicted" ? (
                  <p className="text-xs text-amber-800 dark:text-amber-200">
                    {t("consensus.conflictedNote")}
                  </p>
                ) : null}
                <ul className="flex flex-col gap-2">
                  {g.evidence.slice(0, 5).map((e, i) => (
                    <li
                      key={i}
                      className="border-l-2 border-gray-200 pl-2 dark:border-gray-700"
                    >
                      <p className="text-xs font-medium text-gray-500">
                        {t(`evidence.${e.polarity}`)} · {e.claim}
                      </p>
                      {e.quote ? (
                        <blockquote className="text-sm italic text-gray-800 dark:text-gray-200">
                          “{e.quote}”
                        </blockquote>
                      ) : null}
                      {e.quote && showTranslation ? (
                        <p
                          data-testid="quote-translation"
                          className="text-xs text-gray-500"
                        >
                          {t("evidence.translation")}: {e.claim}
                        </p>
                      ) : null}
                      <p className="text-xs text-gray-400">
                        {e.date
                          ? t("evidence.attributionDated", {
                              source: e.source,
                              date: e.date,
                            })
                          : t("evidence.attribution", { source: e.source })}
                        {e.sourceUrl ? (
                          <>
                            {" · "}
                            <a
                              href={e.sourceUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="underline"
                            >
                              {t("viewSource")}
                            </a>
                          </>
                        ) : null}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      ) : null}

      {redFlags.length > 0 ? (
        <div className="flex flex-col gap-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-red-600 dark:text-red-400">
            {t("redFlags")}
          </p>
          <ul className="list-disc pl-4 text-sm text-red-700 dark:text-red-300">
            {redFlags.map((e, i) => (
              <li key={i}>{e.claim}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {entry.place.url ? (
        <a
          href={entry.place.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm underline"
        >
          {t("links")}
        </a>
      ) : null}
    </article>
  );
}
