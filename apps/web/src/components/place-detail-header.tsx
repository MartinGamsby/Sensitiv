"use client";

import { useTranslations } from "next-intl";
import type { DossierPlace } from "@sensitiv/shared";
import { Badge, MatchPill } from "./ui/index.ts";
import { PlacePhoto } from "./place-photo.tsx";
import { consensusFor, groupByRequirement } from "./dossier-place-card.tsx";

export interface PlaceDetailHeaderProps {
  entry: DossierPlace;
  jobId: string;
  rank: number;
  percent?: number;
}

/**
 * The identity block at the top of a place's detail view: the same rank,
 * photo, name, address, category and match the card showed, at a size that
 * suits a page rather than a tile.
 *
 * Repeating the card's contents is the point. A reader who arrived by
 * clicking needs to see that they landed on the one they picked; a reader who
 * arrived from a pasted link has never seen the card at all.
 */
export function PlaceDetailHeader({
  entry,
  jobId,
  rank,
  percent,
}: PlaceDetailHeaderProps) {
  const t = useTranslations("dossier");
  const groups = groupByRequirement(entry.evidence);
  const anyConflict =
    entry.conflicted || groups.some((g) => consensusFor(g.evidence) === "conflicted");
  const rounded = Math.round(entry.score * 10) / 10;

  return (
    // The pill drops below the identity block on a narrow panel rather than
    // squeezing beside it — at 375px it was taking ~110px and pushing
    // "Crêperie du Marché" onto three lines. A `sm:` breakpoint is honest
    // here, unlike on the card: the panel is `max-w-3xl` and otherwise just
    // tracks the viewport, so window width IS panel width at these sizes.
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <div className="flex min-w-0 gap-3">
        <span
          aria-hidden="true"
          className="mt-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-muted text-sm font-semibold tabular-nums text-fg-muted"
        >
          {rank}
        </span>
        <PlacePhoto
          jobId={jobId}
          name={entry.place.name}
          canonicalKey={entry.place.canonicalKey}
          hasPhoto={entry.place.thumbnailUrl !== undefined}
          size={64}
        />
        <div className="min-w-0">
          <h2
            data-testid="place-detail-name"
            className="text-xl font-semibold leading-tight text-fg"
          >
            {entry.place.name}
          </h2>
          {entry.place.address ? (
            <p className="mt-0.5 text-sm text-fg-muted">{entry.place.address}</p>
          ) : null}
          <p className="mt-1.5 flex flex-wrap items-center gap-2 text-xs uppercase tracking-wide text-fg-subtle">
            {entry.place.category ? <span>{entry.place.category}</span> : null}
            {anyConflict ? (
              <Badge tone="warn">{t("consensus.conflicted")}</Badge>
            ) : null}
          </p>
        </div>
      </div>
      {percent === undefined ? (
        <Badge tone="neutral" size="md" className="w-fit shrink-0 tabular-nums">
          {t("place.score", { score: `${rounded >= 0 ? "+" : ""}${rounded}` })}
        </Badge>
      ) : (
        <MatchPill percent={percent} className="w-fit shrink-0 tabular-nums">
          {t("score.match", { percent })}
        </MatchPill>
      )}
    </div>
  );
}
