"use client";

import { useLocale, useTranslations } from "next-intl";
import { getRequirement, labelOf } from "@sensitiv/shared/catalog/index";
import { scorePercent } from "@sensitiv/shared";
import type { DossierPlace, Evidence, ScoreLine, UiLocale } from "@sensitiv/shared";
import { Badge, Disclosure, type BadgeTone } from "./ui/index.ts";
import { AlertIcon, ExternalIcon, QuoteIcon } from "./ui/icon.tsx";
import {
  consensusFor,
  groupByRequirement,
  humanizeRequirementId,
  safeExternalHref,
  type Consensus,
} from "./dossier-place-card.tsx";
import { parseTagQuote, sourceLabel } from "@/lib/sources.ts";
import { cn } from "@/lib/cn.ts";

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

/**
 * The claim a score line was actually built on, and who said it.
 *
 * The breakdown used to say only "a source supports this requirement", which is
 * true of `diet:gluten_free=yes` and of a review describing a dedicated
 * gluten-free kitchen alike — and those are the two things a reader with
 * coeliac disease most needs told apart. The extractor already writes a plain
 * sentence per claim; this surfaces the strongest one beside the number it
 * produced, with the sources that spoke to the requirement at all.
 *
 * Reads the evidence rather than the line, because a `ScoreLine` records the
 * arithmetic and not its inputs. `proximity` has no requirement and no claim.
 */
function evidenceFor(
  evidence: readonly Evidence[],
  line: ScoreLine,
): { claim?: string; sources: string[] } {
  if (line.rule === "proximity" || line.requirementId === "") {
    return { sources: [] };
  }
  const mine = evidence.filter((e) => e.requirementId === line.requirementId);
  // Whichever polarity this line is about: a `contradicted` line must not be
  // captioned with the supporting claim that sits next to it.
  const wanted =
    line.rule === "contradicted"
      ? mine.filter((e) => e.polarity === "contradicts")
      : mine.filter((e) => e.polarity === "supports");
  const strongest = wanted.reduce<Evidence | undefined>(
    (best, e) => (best === undefined || e.confidence > best.confidence ? e : best),
    undefined,
  );
  return {
    claim: strongest?.claim,
    // Every source that spoke to the requirement, not only the quoted one —
    // "2 sources" is the fact that makes a corroboration line legible.
    sources: [...new Set(mine.map((e) => e.source))],
  };
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
  evidence,
  category,
  score,
  maxScore,
  distanceKm,
}: {
  breakdown: ScoreLine[];
  /** The claims behind the numbers, for the "what was actually said" line. */
  evidence: readonly Evidence[];
  /** The place's own category, named on any line that was settled by it. */
  category?: string;
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
            // What the sources ACTUALLY said, which is the difference between
            // "gluten-free options are available" and "this kitchen is safe for
            // a coeliac" — two claims a single number cannot tell apart, and
            // the whole reason this panel read as arbitrary.
            const said = evidenceFor(evidence, line);
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
                  {/* The claim in the source's own terms, INSTEAD of the rule
                      name's generic wording rather than under it. "A source
                      supports this requirement" is true of a review describing
                      a dedicated kitchen and of `diet:gluten_free=yes` alike,
                      and repeating it above the specific sentence was two lines
                      saying one thing. The generic wording stays for the lines
                      that have no claim behind them. */}
                  <span className="block text-fg-muted">
                    {said.claim ?? detail}
                  </span>
                  {/* Where the number came from: how many sources spoke to this
                      requirement at all, or — when nothing did — the place's own
                      category, which is a different kind of answer and should
                      not be mistaken for a source saying something. */}
                  {said.sources.length > 0 ? (
                    <span className="block text-fg-subtle">
                      {t("score.sourceCount", { count: said.sources.length })}
                      {" · "}
                      {said.sources.map((src) => sourceLabel(src)).join(", ")}
                    </span>
                  ) : line.viaCategory ? (
                    <span className="block text-fg-subtle">
                      {category
                        ? t("score.viaCategoryNamed", { category })
                        : t("score.viaCategory")}
                    </span>
                  ) : null}
                  {/* Never silent. A discount that reorders a dossier and is
                      not stated is exactly the kind of hidden judgement this
                      breakdown exists to prevent. */}
                  {line.discounted ? (
                    <span className="block text-fg-subtle">
                      {t("score.discounted")}
                    </span>
                  ) : null}
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

export interface PlaceDetailBodyProps {
  entry: DossierPlace;
  uiLocale: UiLocale;
  /** BCP-47 code the searches ran in; drives the quote translation line. */
  searchLang: string;
  /** Run-wide ceiling. `undefined` means no percentage can honestly be stated. */
  maxScore?: number;
  /** Distance from the search centre, when the run recorded one. */
  distanceKm?: number;
}

/**
 * Everything the dossier knows about one place: how it scored and why, which
 * listings were read, what each source said about each requirement, and the
 * contradictions.
 *
 * Lives apart from `DossierPlaceCard` because there are two places it renders
 * now — the modal a reader opens from the grid, and the standalone page that
 * same URL serves when it is pasted into a fresh tab. The card is the
 * shortlist entry; this is the answer.
 */
export function PlaceDetailBody({
  entry,
  uiLocale,
  searchLang,
  maxScore,
  distanceKm,
}: PlaceDetailBodyProps) {
  const t = useTranslations("dossier");
  const locale = useLocale() as UiLocale;
  const groups = groupByRequirement(entry.evidence);
  const showTranslation = searchLang.slice(0, 2).toLowerCase() !== uiLocale;
  const redFlags = entry.evidence.filter((e) => e.polarity === "contradicts");
  const placeHref = safeExternalHref(entry.place.url);
  const percent =
    maxScore === undefined ? undefined : scorePercent(entry.score, maxScore);

  return (
    <div className="flex flex-col gap-4">
      {percent !== undefined ? (
        <ScoreBreakdown
          breakdown={entry.breakdown}
          evidence={entry.evidence}
          category={entry.place.category}
          score={entry.score}
          maxScore={maxScore ?? 0}
          distanceKm={distanceKm}
        />
      ) : null}

      {/* Every chip names a page that exists. Linked whenever the source
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
            // and stay folded so a place with five requirements is still
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
  );
}
