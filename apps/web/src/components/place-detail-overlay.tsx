"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { scorePercent } from "@sensitiv/shared";
import type { UiLocale } from "@sensitiv/shared";
import { Disclaimer } from "./disclaimer.tsx";
import { PlaceDetailBody } from "./place-detail-body.tsx";
import { PlaceDetailHeader } from "./place-detail-header.tsx";
import { PlaceModal } from "./place-modal.tsx";
import { PLACE_PARAM } from "@/lib/place-detail-path.ts";
import type { PlacedDossierPlace } from "@/lib/dossier-sort.ts";

export interface PlaceDetailOverlayProps {
  /** The run's places in RECOMMENDED order — the order the rank comes from. */
  ranked: PlacedDossierPlace[];
  jobId: string;
  uiLocale: UiLocale;
  searchLang: string;
  maxScore?: number;
}

/**
 * The place detail, as an overlay driven entirely by the URL.
 *
 * `?place=<canonicalKey>` is the whole state. Nothing here is a `useState`,
 * which is what makes the address bar honest: the link a reader copies opens
 * the same thing they are looking at, Back closes it, and Forward reopens it.
 *
 * It renders from the dossier the page already has, so opening a place costs
 * no request and no spinner.
 *
 * A key that matches nothing renders NOTHING rather than an error. That is
 * the case where a link outlives the run it pointed into — the place was
 * re-ranked out of the dossier, or the run was deleted and re-made — and
 * dropping the reader on the list they asked for beats an error page about a
 * key they never typed.
 *
 * The rank is the position in the recommended order, not in whatever the
 * reader has the sort control set to. A URL that says a different rank
 * depending on a control the recipient never touched says something
 * different to the person it was sent to.
 */
export function PlaceDetailOverlay({
  ranked,
  jobId,
  uiLocale,
  searchLang,
  maxScore,
}: PlaceDetailOverlayProps) {
  const router = useRouter();
  const params = useSearchParams();
  const openKey = params.get(PLACE_PARAM);
  if (!openKey) return null;

  const index = ranked.findIndex((p) => p.place.canonicalKey === openKey);
  if (index === -1) return null;

  const entry = ranked[index]!;
  const percent =
    maxScore === undefined ? undefined : scorePercent(entry.score, maxScore);

  return (
    <PlaceModal onClose={() => router.back()}>
      <div className="flex flex-col gap-5">
        <PlaceDetailHeader
          entry={entry}
          jobId={jobId}
          rank={index + 1}
          percent={percent}
        />
        <PlaceDetailBody
          entry={entry}
          uiLocale={uiLocale}
          searchLang={searchLang}
          maxScore={maxScore}
          distanceKm={entry.distanceKm}
        />
        {/* The overlay covers the dossier's copy, so it carries its own. No
            view that presents research as an answer goes without it. */}
        <Disclaimer />
      </div>
    </PlaceModal>
  );
}
