"use client";

import { useLocale, useTranslations } from "next-intl";
import { getRequirement, labelOf } from "@sensitiv/shared/catalog/index";
import type { DossierPlace, Evidence, UiLocale } from "@sensitiv/shared";
import { Badge, Card, Disclosure, type BadgeTone } from "./ui/index.ts";
import { AlertIcon, ExternalIcon, QuoteIcon } from "./ui/icon.tsx";
import { cn } from "@/lib/cn.ts";

export type Consensus = "agreed" | "conflicted" | "single";

/**
 * `place.url` / `evidence.sourceUrl` are LLM output derived from scraped,
 * attacker-influenceable page content, and neither `PlaceDetailSchema.url` nor
 * `PlaceSourceSchema.sourceUrl` constrains the scheme. Render a link only for an
 * absolute http(s) URL; anything else (`javascript:`, `data:`, `blob:`, a
 * relative path that would resolve against our own origin) renders as no link
 * at all. React 19 already neutralises `javascript:` hrefs — this closes the
 * rest of the scheme space rather than relying on that one framework behaviour.
 */
export function safeExternalHref(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return undefined;
  }
  return parsed.protocol === "http:" || parsed.protocol === "https:"
    ? parsed.href
    : undefined;
}

/**
 * The URL of a place photo, or nothing.
 *
 * Deliberately stricter than `safeExternalHref`: that one guards a link the
 * user chooses to follow, whereas this becomes an `<img src>` the browser
 * fetches on its own. Only Google user-content hosts, which is the only place
 * the worker ever captures one from. The worker validates on the way in too —
 * this is the gate that also covers rows written before that check existed.
 */
export function safeThumbnailSrc(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "https:") return undefined;
  return /^[a-z0-9-]+\.googleusercontent\.com$/.test(parsed.hostname.toLowerCase())
    ? parsed.href
    : undefined;
}

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

/**
 * Display fallback for a requirement id the catalog does not know — the
 * planner mints ad-hoc ones like `custom_mexican_restaurant` per run, and the
 * raw id was rendering as a card heading. Presentation only: the catalog stays
 * the source of truth for the ids that *are* real, and this never invents a
 * label for one of those.
 */
export function humanizeRequirementId(id: string): string {
  const words = id.replace(/^custom[_-]/, "").replace(/[_-]+/g, " ").trim();
  if (words === "") return id;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const CONSENSUS_TONE: Record<Consensus, BadgeTone> = {
  agreed: "ok",
  conflicted: "warn",
  single: "neutral",
};

/** Accent rail down the left of an excerpt, by what the excerpt does. */
const POLARITY_RAIL: Record<string, string> = {
  supports: "border-ok-300 dark:border-ok-800",
  contradicts: "border-danger-300 dark:border-danger-800",
  unclear: "border-border-subtle",
};

const POLARITY_TEXT: Record<string, string> = {
  supports: "text-ok-700 dark:text-ok-300",
  contradicts: "text-danger-700 dark:text-danger-300",
  unclear: "text-fg-muted",
};

/** One quoted excerpt: what it claims, the quote itself, and who said it. */
function EvidenceItem({
  evidence,
  showTranslation,
}: {
  evidence: Evidence;
  showTranslation: boolean;
}) {
  const t = useTranslations("dossier");
  const sourceHref = safeExternalHref(evidence.sourceUrl);

  return (
    <li className={cn("border-l-2 pl-3", POLARITY_RAIL[evidence.polarity] ?? POLARITY_RAIL.unclear)}>
      <p className="text-xs font-medium">
        <span className={POLARITY_TEXT[evidence.polarity] ?? POLARITY_TEXT.unclear}>
          {t(`evidence.${evidence.polarity}`)}
        </span>
        <span className="text-fg-muted"> · {evidence.claim}</span>
      </p>

      {evidence.quote ? (
        <blockquote className="mt-1.5 flex gap-1.5 text-sm italic leading-relaxed text-fg">
          <QuoteIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-fg-subtle" />
          <span>“{evidence.quote}”</span>
        </blockquote>
      ) : null}

      {evidence.quote && showTranslation ? (
        <p data-testid="quote-translation" className="mt-1 pl-5 text-xs text-fg-muted">
          {t("evidence.translation")}: {evidence.claim}
        </p>
      ) : null}

      <p className="mt-1 text-xs text-fg-subtle">
        {evidence.date
          ? t("evidence.attributionDated", {
              source: evidence.source,
              date: evidence.date,
            })
          : t("evidence.attribution", { source: evidence.source })}
        {sourceHref ? (
          <>
            {" · "}
            <a
              href={sourceHref}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-brand underline-offset-2 hover:underline"
            >
              {t("viewSource")}
            </a>
          </>
        ) : null}
      </p>
    </li>
  );
}

export interface DossierPlaceCardProps {
  entry: DossierPlace;
  uiLocale: UiLocale;
  /** BCP-47 code the searches ran in; drives the quote translation line. */
  searchLang: string;
  /** 1-based position in the ranked list. */
  rank?: number;
}

export function DossierPlaceCard({
  entry,
  uiLocale,
  searchLang,
  rank,
}: DossierPlaceCardProps) {
  const t = useTranslations("dossier");
  const locale = useLocale() as UiLocale;
  const groups = groupByRequirement(entry.evidence);
  const anyConflict =
    entry.conflicted || groups.some((g) => consensusFor(g.evidence) === "conflicted");
  const showTranslation =
    searchLang.slice(0, 2).toLowerCase() !== uiLocale;

  const redFlags = entry.evidence.filter((e) => e.polarity === "contradicts");
  const placeHref = safeExternalHref(entry.place.url);
  const thumbnail = safeThumbnailSrc(entry.place.thumbnailUrl);
  const scoreLabel = `${entry.score >= 0 ? "+" : ""}${entry.score}`;

  return (
    <Card
      as="article"
      padding="lg"
      tone={anyConflict ? "warn" : "default"}
      data-conflicted={anyConflict ? "true" : "false"}
      className="flex flex-col gap-4"
    >
      <header className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 gap-3">
          {rank !== undefined ? (
            <span
              aria-hidden="true"
              className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-muted text-sm font-semibold tabular-nums text-fg-muted"
            >
              {rank}
            </span>
          ) : null}
          {thumbnail ? (
            // Decorative: the name, address and category right beside it say
            // everything this conveys, so a screen reader gains nothing from a
            // generated description of a stock photo of a storefront.
            // `referrerPolicy` keeps the dossier's own URL out of the request.
            <img
              src={thumbnail}
              alt=""
              aria-hidden="true"
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
              width={64}
              height={64}
              className="h-16 w-16 shrink-0 rounded-md object-cover bg-surface-muted"
              // A photo URL can expire or 404; a broken-image icon is worse
              // than no image, so the element removes itself.
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
            />
          ) : null}
          <div className="min-w-0">
            <h3 className="text-lg font-semibold leading-tight text-fg">
              {entry.place.name}
            </h3>
            {entry.place.address ? (
              <p className="mt-0.5 text-sm text-fg-muted">{entry.place.address}</p>
            ) : null}
            {entry.place.category ? (
              <p className="mt-1 text-xs uppercase tracking-wide text-fg-subtle">
                {entry.place.category}
              </p>
            ) : null}
          </div>
        </div>
        <Badge tone="neutral" size="md" className="shrink-0 tabular-nums">
          {t("place.score", { score: scoreLabel })}
        </Badge>
      </header>

      {entry.sources.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {entry.sources.map((s, i) => (
            <li
              key={`${s.source}-${i}`}
              className="rounded-full border border-border-subtle px-2.5 py-0.5 text-xs text-fg-muted"
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
        <div className="flex flex-col gap-4 border-t border-border-subtle pt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">
            {t("place.requirementMatch")}
          </p>
          {groups.map((g) => {
            const consensus = consensusFor(g.evidence);
            const reqLabel =
              labelOf(getRequirement(g.requirementId), locale) ||
              humanizeRequirementId(g.requirementId);
            // The first excerpt carries the verdict; the rest are corroboration
            // and stay folded so a card with five requirements is still
            // readable at a glance. They remain in the DOM either way.
            const [lead, ...rest] = g.evidence.slice(0, 5);
            return (
              <div key={g.requirementId} className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-fg">{reqLabel}</span>
                  <Badge tone={CONSENSUS_TONE[consensus]}>
                    {t(`consensus.${consensus}`)}
                  </Badge>
                </div>

                {consensus === "conflicted" ? (
                  <p className="text-xs leading-relaxed text-warn-800 dark:text-warn-200">
                    {t("consensus.conflictedNote")}
                  </p>
                ) : null}

                {lead ? (
                  <ul className="flex flex-col gap-3">
                    <EvidenceItem evidence={lead} showTranslation={showTranslation} />
                  </ul>
                ) : null}

                {rest.length > 0 ? (
                  <Disclosure
                    summary={t("place.moreExcerpts", { count: rest.length })}
                    triggerClassName="text-xs"
                    contentClassName="pt-2"
                  >
                    <ul className="flex flex-col gap-3">
                      {rest.map((e, i) => (
                        <EvidenceItem
                          key={i}
                          evidence={e}
                          showTranslation={showTranslation}
                        />
                      ))}
                    </ul>
                  </Disclosure>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}

      {redFlags.length > 0 ? (
        <div className="rounded-lg border border-danger-200 bg-danger-50 p-3 dark:border-danger-900/70 dark:bg-danger-950/40">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-danger-700 dark:text-danger-300">
            <AlertIcon className="h-3.5 w-3.5" />
            {t("redFlags")}
          </p>
          <ul className="mt-1.5 list-disc pl-5 text-sm leading-relaxed text-danger-800 dark:text-danger-200">
            {redFlags.map((e, i) => (
              <li key={i}>{e.claim}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {placeHref ? (
        <a
          href={placeHref}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-brand underline-offset-2 hover:underline"
        >
          {t("links")}
          <ExternalIcon className="h-3.5 w-3.5" />
        </a>
      ) : null}
    </Card>
  );
}
