"use client";

import { useLocale, useTranslations } from "next-intl";
import { MAX_REQUIREMENT_BASE, scorePercent } from "@sensitiv/shared";
import type { DossierPlace, Evidence, UiLocale } from "@sensitiv/shared";
import { getRequirement, labelOf } from "@sensitiv/shared/catalog/index";
import { Badge, Card, MatchPill, RankMedal } from "./ui/index.ts";
import { ChevronIcon } from "./ui/icon.tsx";
import { PlacePhoto } from "./place-photo.tsx";
import { Link } from "@/i18n/navigation.ts";
import { placeDetailPath } from "@/lib/place-detail-path.ts";
import {
  formatDelta,
  markTone,
  requirementMarks,
} from "@/lib/requirement-marks.ts";

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

/**
 * One pill per requirement, with what it contributed.
 *
 * The overall percentage answers "how good is this place", which is not the
 * question this app is for. On the run that prompted these, `Escondite` ranked
 * third on a celiac search: explicitly a Mexican restaurant, with NOTHING said
 * about gluten — and the single number on the card could not tell a reader
 * which half of it they were looking at. With the pills, a column of cards can
 * be scanned for the one requirement that matters and the cuisine read as the
 * filter it is.
 *
 * Every planned requirement gets a pill, including the ones no source settled:
 * `scorePlace` emits an `unverified` line for each of those precisely so the
 * dossier can say "we looked and found nothing" rather than let the requirement
 * vanish. A silent gap would read as a pass.
 *
 * Never folded away: reading these is the shortlist's whole job.
 */
function RequirementMarks({ entry }: { entry: DossierPlace }) {
  const t = useTranslations("dossier");
  const locale = useLocale() as UiLocale;
  const marks = requirementMarks(entry.breakdown);
  if (marks.length === 0) return null;

  return (
    <span className="mt-2 flex flex-wrap gap-1">
      {marks.map((mark) => {
        const label =
          labelOf(getRequirement(mark.requirementId), locale) ||
          humanizeRequirementId(mark.requirementId);
        // A percentage of what THIS requirement could contribute, not a raw
        // signed delta. "+7.2" is unreadable on a shortlist: nothing on the
        // card says what the top of that scale is, so the number only ever
        // meant anything next to another card's. The ceiling is the same one
        // the overall match divides by — `MAX_REQUIREMENT_BASE * weight`,
        // corroboration included, so a corroborated requirement cannot come
        // out above 100%.
        const percent = mark.settled
          ? scorePercent(mark.delta, MAX_REQUIREMENT_BASE * mark.weight)
          : undefined;
        return (
          <Badge
            key={mark.requirementId}
            tone={markTone(mark)}
            data-testid="requirement-mark"
            data-requirement={mark.requirementId}
            // The number alone is meaningless to a screen reader ("Celiac
            // +9.6"), so the accessible name spells out what it means and the
            // visible pill stays short enough to scan.
            // The pill is two words and a number; the accessible name carries
            // what they mean, including the raw contribution the percentage
            // came from so it is not lost.
            title={
              percent === undefined
                ? `${label} — ${t("score.rule.unverified")}`
                : t("place.markTitle", {
                    label,
                    percent,
                    delta: formatDelta(mark.delta),
                  }) + (mark.conflicted ? ` — ${t("consensus.conflicted")}` : "")
            }
          >
            <span className="max-w-[10rem] truncate">{label}</span>
            <span className="tabular-nums font-semibold">
              {percent === undefined ? t("place.markUnknown") : `${percent}%`}
            </span>
          </Badge>
        );
      })}
    </span>
  );
}

export interface DossierPlaceCardProps {
  entry: DossierPlace;
  /** Addresses this place's photo, and its detail page, under this run. */
  jobId: string;
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
}

/**
 * One place, as a shortlist entry.
 *
 * The whole card is a link to `/jobs/:id/places/:key`, which is a real
 * address: opened from here it arrives as a modal over the dossier, and
 * pasted into a fresh tab it serves the same content as a page. That is why
 * the card stopped being a disclosure — an expanded card had no URL, so
 * "look at this one" was not a thing a reader could send anyone, and a card
 * that grew in place made every card in its row grow with it.
 *
 * What stays here is what picks a place out of a list: rank, photo, name,
 * address, category, the match, and — never folded away — whether the
 * sources disagreed.
 */
export function DossierPlaceCard({
  entry,
  jobId,
  rank,
  maxScore,
}: DossierPlaceCardProps) {
  const t = useTranslations("dossier");
  const groups = groupByRequirement(entry.evidence);
  const anyConflict =
    entry.conflicted || groups.some((g) => consensusFor(g.evidence) === "conflicted");

  // Scores became continuous when confidence and distance started feeding them,
  // so `+5.7000000000000002` is now reachable. One decimal is the resolution
  // that distinguishes two places without pretending to more precision than a
  // heuristic has; a whole number still renders as one.
  const rounded = Math.round(entry.score * 10) / 10;
  const scoreLabel = `${rounded >= 0 ? "+" : ""}${rounded}`;
  // "+5.7" told a reader nothing: nothing on the card said what the top of the
  // scale was, so the number was only ever meaningful next to another card's.
  // A percentage of the best this run could have scored is a number someone can
  // read on its own — and the breakdown behind it is what keeps it from being
  // a black box.
  const percent =
    maxScore === undefined ? undefined : scorePercent(entry.score, maxScore);

  return (
    <Card
      as="article"
      padding="none"
      tone={anyConflict ? "warn" : "default"}
      data-conflicted={anyConflict ? "true" : "false"}
      // `h-full` so a card fills the row it is in: grid rows are as tall as
      // their tallest item, and without this a one-line name next to a
      // two-line one left a visible shelf under the shorter card.
      //
      // `relative` and deliberately NOT `overflow-hidden`: the rank medal is
      // positioned against this box and hangs half over its top edge, so the
      // card has to be the offset parent AND has to let it out. The link
      // inside carries its own `rounded-xl` for the hover fill, which is what
      // the clipping used to do.
      className="relative h-full"
    >
      {/* The heading wraps the link rather than sitting beside it, so the card
          is still a landmark a screen reader can jump between by heading while
          the whole tile stays one hit target. Everything inside is phrasing
          content, which is what makes that legal. */}
      {rank !== undefined ? <RankMedal rank={rank} /> : null}

      <h3 className="h-full">
        <Link
          href={placeDetailPath(jobId, entry.place.canonicalKey)}
          // `rounded-xl` to match the card: the card can no longer clip this
          // (it has to let the rank medal out), so the hover fill has to
          // respect the corners itself.
          //
          // `pt-6` clears the medal, which hangs half over the top edge.
          className="flex h-full w-full items-start gap-3 rounded-xl p-4 pt-6 text-left transition-colors hover:bg-surface-muted/60"
        >
          {/* Photo and score in one column. They belong together — both
              answer "is this one worth opening" at a glance — and putting
              the score here instead of in a right-hand rail gives the name
              back the ~90px that rail was costing, which is the difference
              between a two-line and a four-line title in a narrow column. */}
          <span className="flex shrink-0 flex-col items-center gap-2">
            {/* Always rendered, photo or not. A card with no image element
                started its title at a different x than its neighbours', and
                a list of sixteen results read as ragged because of it. */}
            <PlacePhoto
              jobId={jobId}
              name={entry.place.name}
              canonicalKey={entry.place.canonicalKey}
              hasPhoto={entry.place.thumbnailUrl !== undefined}
            />
            {/* A raw score has no ceiling to be a fraction of, so there is
                nothing honest to tint it by — it stays the neutral chip. */}
            {percent === undefined ? (
              <Badge tone="neutral" className="tabular-nums">
                {t("place.score", { score: scoreLabel })}
              </Badge>
            ) : (
              <MatchPill percent={percent} size="sm" className="tabular-nums">
                {t("score.match", { percent })}
              </MatchPill>
            )}
          </span>

          <span className="min-w-0 flex-1">
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
              {/* Never behind the link. The amber card tone is a colour-only
                  cue, and "sources disagree about whether this kitchen is
                  safe" is exactly the fact a reader skimming a shortlist
                  needs BEFORE deciding which one to open. */}
              {anyConflict ? (
                <Badge tone="warn">{t("consensus.conflicted")}</Badge>
              ) : null}
            </span>

            <RequirementMarks entry={entry} />
          </span>

          {/* The affordance, and nothing else. "Details" spelled out beside
              it was a second thing to read on a card whose whole job is to
              be skimmed — and the chevron says the same thing in 14px. It
              sits at the card's right edge on every card, so the eye can
              run down the column without hunting for it. The link's
              accessible name is already the place, so this is decorative. */}
          <ChevronIcon
            aria-hidden="true"
            className="h-4 w-4 shrink-0 self-center text-fg-subtle"
          />
        </Link>
      </h3>
    </Card>
  );
}
