"use client";

import { useId, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { getRequirement, labelOf } from "@sensitiv/shared/catalog/index";
import { scorePercent } from "@sensitiv/shared";
import type {
  DossierPlace,
  Evidence,
  ScoreLine,
  UiLocale,
} from "@sensitiv/shared";
import { Badge, Card, Disclosure, type BadgeTone } from "./ui/index.ts";
import { AlertIcon, ChevronIcon, ExternalIcon, QuoteIcon } from "./ui/icon.tsx";
import { PlacePhoto } from "./place-photo.tsx";
import { parseTagQuote, sourceLabel } from "@/lib/sources.ts";
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

/**
 * One quoted excerpt: what it claims, the quote itself, and who said it.
 *
 * Two shapes, because a dossier holds two kinds of quote. A review or a menu
 * line is prose, and the pull-quote below is the right frame for it. An
 * OpenStreetMap tag is not prose — `diet:gluten_free=only` is a field someone
 * filled in — and dressing it in curly quotes as though a person said it out
 * loud made the most exact evidence in the app look like the least readable.
 * A tag keeps its key and value verbatim, because that is what a reader would
 * check against OSM, but renders as a key/value chip; the plain sentence the
 * adapter already writes moves up to carry the meaning.
 */
function EvidenceItem({
  evidence,
  showTranslation,
}: {
  evidence: Evidence;
  showTranslation: boolean;
}) {
  const t = useTranslations("dossier");
  const sourceHref = safeExternalHref(evidence.sourceUrl);
  const tag = parseTagQuote(evidence.quote);

  return (
    <li className={cn("border-l-2 pl-3", POLARITY_RAIL[evidence.polarity] ?? POLARITY_RAIL.unclear)}>
      <p className="text-xs font-medium">
        <span className={POLARITY_TEXT[evidence.polarity] ?? POLARITY_TEXT.unclear}>
          {t(`evidence.${evidence.polarity}`)}
        </span>
        {/* Beside a prose quote the claim is a caption and stays small. With a
            tag there is no prose underneath, so the claim IS the sentence and
            gets its own line at reading size below. */}
        {tag ? null : <span className="text-fg-muted"> · {evidence.claim}</span>}
      </p>

      {tag ? (
        <>
          <p className="mt-1 text-sm leading-relaxed text-fg">{evidence.claim}</p>
          <p
            data-testid="tag-quote"
            className="mt-1.5 flex flex-wrap items-baseline gap-1.5 text-xs"
          >
            <span className="text-fg-subtle">{t("evidence.tag")}</span>
            <code className="rounded border border-border-subtle bg-surface-muted px-1.5 py-0.5 font-mono text-fg-muted">
              {tag.key} = {tag.value}
            </code>
          </p>
        </>
      ) : evidence.quote ? (
        <blockquote className="mt-1.5 flex gap-1.5 text-sm italic leading-relaxed text-fg">
          <QuoteIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-fg-subtle" />
          <span>“{evidence.quote}”</span>
        </blockquote>
      ) : null}

      {/* A tag has no source language to be translated out of — `only` is
          `only` in every locale — so this line is prose-only. */}
      {evidence.quote && showTranslation && !tag ? (
        <p data-testid="quote-translation" className="mt-1 pl-5 text-xs text-fg-muted">
          {t("evidence.translation")}: {evidence.claim}
        </p>
      ) : null}

      <p className="mt-1 text-xs text-fg-subtle">
        {evidence.date
          ? t("evidence.attributionDated", {
              source: sourceLabel(evidence.source),
              date: evidence.date,
            })
          : t("evidence.attribution", { source: sourceLabel(evidence.source) })}
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

/** `+5.85` / `-1.7` / `0` — signed, one decimal, whole numbers stay whole. */
function formatDelta(delta: number): string {
  const rounded = Math.round(delta * 10) / 10;
  return `${rounded > 0 ? "+" : ""}${rounded}`;
}

/**
 * Why the percentage is what it is.
 *
 * Reads the breakdown the WORKER stored, rather than re-deriving one here: the
 * lines that ranked this place are the lines a reader should be shown, even
 * once the rubric has moved on. The rule is an enum, so it translates; the
 * requirement label comes from the catalog like everywhere else; and the
 * distance is measured here from the run's own centre, which is the one number
 * the stored line holds only as English prose.
 *
 * A place scored before the breakdown was persisted has none, and this says so
 * instead of guessing at one.
 */
function ScoreBreakdown({
  breakdown,
  score,
  maxScore,
  distanceKm,
}: {
  breakdown: ScoreLine[];
  score: number;
  maxScore: number;
  distanceKm?: number;
}) {
  const t = useTranslations("dossier");
  const locale = useLocale() as UiLocale;

  return (
    <div className="rounded-lg border border-border-subtle bg-surface-muted p-3 text-xs">
      <p className="font-semibold uppercase tracking-wide text-fg-subtle">
        {t("score.explain")}
      </p>

      {breakdown.length === 0 ? (
        <p className="mt-2 text-fg-muted">{t("score.noBreakdown")}</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-1.5">
          {breakdown.map((line, i) => {
            const subject =
              line.rule === "proximity"
                ? t("score.distance")
                : labelOf(getRequirement(line.requirementId), locale) ||
                  humanizeRequirementId(line.requirementId);
            const detail =
              line.rule === "proximity" && distanceKm !== undefined
                ? t("score.distanceFrom", { km: distanceKm })
                : t(`score.rule.${line.rule}`);
            return (
              <li key={`${line.requirementId}-${line.rule}-${i}`} className="flex gap-2">
                <span
                  className={cn(
                    "w-12 shrink-0 text-right font-semibold tabular-nums",
                    line.delta > 0
                      ? "text-ok-700 dark:text-ok-300"
                      : line.delta < 0
                        ? "text-danger-700 dark:text-danger-300"
                        : "text-fg-subtle",
                  )}
                >
                  {formatDelta(line.delta)}
                </span>
                <span className="min-w-0">
                  <span className="font-medium text-fg">{subject}</span>
                  {/* A weight is the catalog saying "this one matters more".
                      Only worth naming when it is not the plain 1. */}
                  {line.rule !== "proximity" && line.weight !== 1 ? (
                    <span className="text-fg-subtle">
                      {" "}
                      {t("score.weight", { weight: line.weight })}
                    </span>
                  ) : null}
                  <span className="block text-fg-muted">{detail}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-2 border-t border-border-subtle pt-2 text-fg-muted">
        {t("score.total", {
          score: formatDelta(score),
          max: Math.round(maxScore * 10) / 10,
        })}
      </p>
    </div>
  );
}

export interface DossierPlaceCardProps {
  entry: DossierPlace;
  /** Needed to address this place's photo through our own origin. */
  jobId: string;
  uiLocale: UiLocale;
  /** BCP-47 code the searches ran in; drives the quote translation line. */
  searchLang: string;
  /** 1-based position in the ranked list. */
  rank?: number;
  /**
   * The best score any place on THIS run could have earned, which turns the
   * raw sum into a percentage.
   *
   * Passed in rather than derived per card on purpose: it is a property of the
   * run, and computing it per place would divide two places by different
   * numbers and let the second-ranked one display the higher percentage.
   * `undefined` (or `0`) means no percentage can honestly be stated, and the
   * card falls back to the raw signed score.
   */
  maxScore?: number;
  /** Distance from the search centre, when the run recorded one. */
  distanceKm?: number;
}

export function DossierPlaceCard({
  entry,
  jobId,
  uiLocale,
  searchLang,
  rank,
  maxScore,
  distanceKm,
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
  // Scores became continuous when confidence and distance started feeding them,
  // so `+5.7000000000000002` is now reachable. One decimal is the resolution
  // that distinguishes two places without pretending to more precision than a
  // heuristic has; a whole number still renders as one.
  const rounded = Math.round(entry.score * 10) / 10;
  const scoreLabel = `${rounded >= 0 ? "+" : ""}${rounded}`;
  // "+5.7" told a reader nothing: nothing on the card said what the top of the
  // scale was, so the number was only ever meaningful next to another card's.
  // A percentage of the best this run could have scored is a number someone can
  // read on its own — and the breakdown underneath is what keeps it from being
  // a black box.
  const percent =
    maxScore === undefined ? undefined : scorePercent(entry.score, maxScore);
  // Collapsed by default. A dossier is a shortlist before it is a reading
  // task: the question the list answers is "which of these is worth my
  // afternoon", and twelve full-height cards answer it worse than twelve
  // one-line ones. Nothing is dropped — every excerpt, chip and red flag is
  // one click away in the panel below, and stays in the DOM while folded so
  // the browser's in-page search still reaches it.
  const [open, setOpen] = useState(false);
  const panelId = useId();

  return (
    <Card
      as="article"
      padding="none"
      tone={anyConflict ? "warn" : "default"}
      data-conflicted={anyConflict ? "true" : "false"}
      className="overflow-hidden"
    >
      {/* The WAI accordion shape: the heading wraps the trigger rather than
          sitting beside it, so the card is still a landmark a screen reader
          can jump between by heading while the whole row stays one hit
          target. Everything inside is phrasing content, which is what makes
          a button legal as a heading's only child. */}
      <h3>
        <button
          type="button"
          onClick={() => setOpen((wasOpen) => !wasOpen)}
          aria-expanded={open}
          aria-controls={panelId}
          className="flex w-full items-start justify-between gap-3 p-4 text-left transition-colors hover:bg-surface-muted/60"
        >
          <span className="flex min-w-0 gap-3">
            {rank !== undefined ? (
              <span
                aria-hidden="true"
                className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-muted text-sm font-semibold tabular-nums text-fg-muted"
              >
                {rank}
              </span>
            ) : null}
            {/* Always rendered, photo or not. A card with no image element
                started its title at a different x than its neighbours', and
                a list of sixteen results read as ragged because of it. */}
            <PlacePhoto
              jobId={jobId}
              name={entry.place.name}
              canonicalKey={entry.place.canonicalKey}
              hasPhoto={entry.place.thumbnailUrl !== undefined}
            />
            <span className="min-w-0">
              <span
                data-testid="place-name"
                className="block text-base font-semibold leading-tight text-fg"
              >
                {entry.place.name}
              </span>
              {entry.place.address ? (
                <span className="mt-0.5 block truncate text-sm text-fg-muted">
                  {entry.place.address}
                </span>
              ) : null}
              <span className="mt-1 flex flex-wrap items-center gap-2 text-xs uppercase tracking-wide text-fg-subtle">
                {entry.place.category ? <span>{entry.place.category}</span> : null}
                {/* The one thing that must survive the fold. The amber card tone
                    is a colour-only cue, and "sources disagree about whether
                    this kitchen is safe" is exactly the fact a reader skimming a
                    shortlist needs BEFORE they pick which card to open. */}
                {anyConflict ? (
                  <Badge tone="warn">{t("consensus.conflicted")}</Badge>
                ) : null}
              </span>
            </span>
          </span>
          <span className="flex shrink-0 flex-col items-end gap-1.5">
            <Badge tone="neutral" size="md" className="tabular-nums">
              {percent === undefined
                ? t("place.score", { score: scoreLabel })
                : t("score.match", { percent })}
            </Badge>
            <span className="flex items-center gap-1 text-xs text-fg-muted">
              {t("place.details")}
              <ChevronIcon
                className={cn(
                  "h-3.5 w-3.5 transition-transform",
                  open && "rotate-90",
                )}
              />
            </span>
          </span>
        </button>
      </h3>

      {/* Mounted whether or not it is open, for the same reason `Disclosure`
          is: a folded panel should still be findable by the browser's in-page
          search, and no fact about a place may depend on a click having
          happened. */}
      <div
        id={panelId}
        hidden={!open}
        // `flex` only while open, and that is not a style choice. Tailwind's
        // preflight hides `[hidden]` with `display: none`, but a `.flex`
        // utility has the same specificity and lands later in the cascade, so
        // a permanently-flex panel renders wide open with the attribute set.
        className={cn(
          "flex-col gap-4 border-t border-border-subtle p-4",
          open && "flex",
        )}
      >
        {percent !== undefined ? (
          <ScoreBreakdown
            breakdown={entry.breakdown}
            score={entry.score}
            maxScore={maxScore ?? 0}
            distanceKm={distanceKm}
          />
        ) : null}

        {/* Every chip names a page that exists — "google_maps · Rating 4.6" was
            a citation with no way to go and read it. Linked whenever the source
            recorded a usable URL, plain text when it did not, because a chip
            that looks clickable and is not is worse than one that never did. */}
        {entry.sources.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5">
            {entry.sources.map((s, i) => {
              const href = safeExternalHref(s.sourceUrl);
              const label = sourceLabel(s.source);
              const detail =
                (typeof s.rating === "number"
                  ? ` · ${t("place.rating", { rating: s.rating })}`
                  : "") +
                (typeof s.reviewCount === "number"
                  ? ` · ${t("place.reviews", { count: s.reviewCount })}`
                  : "");
              const chip =
                "inline-flex items-center gap-1 rounded-full border border-border-subtle px-2.5 py-0.5 text-xs";
              return (
                <li key={`${s.source}-${i}`}>
                  {href ? (
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={t("place.openOnSource", { source: label })}
                      className={cn(
                        chip,
                        "text-fg-muted transition-colors hover:border-brand hover:text-brand",
                      )}
                    >
                      {label}
                      {detail}
                      <ExternalIcon className="h-3 w-3" />
                    </a>
                  ) : (
                    <span className={cn(chip, "text-fg-muted")}>
                      {label}
                      {detail}
                    </span>
                  )}
                </li>
              );
            })}
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
            {t("website")}
            <ExternalIcon className="h-3.5 w-3.5" />
          </a>
        ) : null}
      </div>
    </Card>
  );
}
