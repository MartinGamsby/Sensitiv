"use client";

import { useMemo, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { maxAchievableScore } from "@sensitiv/shared";
import type { Dossier as DossierData, DossierReplay } from "@sensitiv/shared";
import { Disclaimer } from "./disclaimer.tsx";
import { DossierPlaceCard, safeExternalHref } from "./dossier-place-card.tsx";
import {
  Card,
  Disclosure,
  EmptyState,
  MetaRow,
  SectionHeading,
  Select,
  Stack,
} from "./ui/index.ts";
import {
  placesWithDistance,
  requirementSortOptions,
  sortFromValue,
  sortPlaces,
  sortToValue,
  type DossierSort,
} from "@/lib/dossier-sort.ts";
import { AlertIcon, DownloadIcon, ExternalIcon } from "./ui/icon.tsx";
import { PlaceDetailOverlay } from "./place-detail-overlay.tsx";
import type { RunBriefData } from "@/lib/run-brief.ts";

/** `sizeBytes` in, a locale-formatted "1.2 MB" / "340 KB" out. */
function formatSize(bytes: number, locale: string): string {
  const nf = (maximumFractionDigits: number) =>
    new Intl.NumberFormat(locale, { maximumFractionDigits });
  if (bytes >= 1024 * 1024) return `${nf(1).format(bytes / (1024 * 1024))} MB`;
  return `${nf(1).format(Math.max(bytes / 1024, 0.1))} KB`;
}

/**
 * One row of `dossier.replays`: which source it is, what it contributed, and
 * an honest availability state. `stored` is the only status with a link into
 * OUR OWN download route; a `link_only` replay still goes through
 * `safeExternalHref` exactly like the old flat list did — the presigned
 * Solari URL is third-party output the gateway could answer with a hostile
 * scheme (see memory/security-invariants.md). An expired `link_only` URL
 * renders as plain text, never a dead — or worse, resurrected-later — link.
 */
function ReplayRow({
  replay,
  jobId,
  uiLocale,
}: {
  replay: DossierReplay;
  jobId: string;
  uiLocale: string;
}) {
  const t = useTranslations("dossier");
  const format = useFormatter();

  const sourceLabel = replay.adapterId ?? t("replay.unknownSource");
  const findingsLabel =
    replay.findingCount === undefined
      ? undefined
      : replay.findingCount > 0
        ? t("replay.findings", { count: replay.findingCount })
        : t("replay.noFindings");

  const expired =
    replay.expiresAt !== undefined && replay.expiresAt < Date.now();
  const safeUrl = safeExternalHref(replay.url);

  let availability: React.ReactNode;
  switch (replay.status) {
    case "stored":
      availability = (
        <a
          href={`/api/jobs/${jobId}/replays/${replay.id}`}
          className="inline-flex items-center gap-1 font-medium text-brand underline-offset-2 hover:underline"
        >
          <DownloadIcon className="h-3.5 w-3.5" />
          {/* A pre-existing row can be `stored` with a NULL `size_bytes`;
              `formatSize(0)` would claim "0.1 KB", so say nothing about the
              size rather than something false. */}
          {replay.sizeBytes === undefined
            ? t("replay.downloadNoSize")
            : t("replay.download", {
                size: formatSize(replay.sizeBytes, uiLocale),
              })}
        </a>
      );
      break;
    case "link_only":
      availability =
        safeUrl && !expired ? (
          <span>
            <a
              href={safeUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-medium text-brand underline-offset-2 hover:underline"
            >
              {t("replayUrl")}
              <ExternalIcon className="h-3 w-3" />
            </a>
            {replay.expiresAt !== undefined ? (
              <>
                {" — "}
                {t("replay.expiresAt", {
                  time: format.dateTime(new Date(replay.expiresAt), {
                    dateStyle: "short",
                    timeStyle: "short",
                  }),
                })}
              </>
            ) : null}
          </span>
        ) : (
          <span className="italic">
            {expired ? t("replay.expired") : t("replay.unavailable")}
          </span>
        );
      break;
    case "empty":
      availability = <span className="italic">{t("replay.empty")}</span>;
      break;
    case "too_large":
      availability = <span className="italic">{t("replay.tooLarge")}</span>;
      break;
    case "expired":
      // Deliberately NOT folded into `unavailable`: this recording existed and
      // was deleted by the retention sweep. "We kept it for N days" and "there
      // was never anything here" are different facts about a run.
      availability = <span className="italic">{t("replay.pruned")}</span>;
      break;
    case "unavailable":
    default:
      availability = <span className="italic">{t("replay.unavailable")}</span>;
      break;
  }

  return (
    <li>
      <MetaRow
        className="rounded-lg px-2 py-1.5 hover:bg-surface-muted"
        label={sourceLabel}
        value={
          <>
            {findingsLabel ? <>· {findingsLabel} </> : null}
            · {availability}
          </>
        }
      />
    </li>
  );
}

/**
 * The dossier: the mandatory disclaimer, then one card per place ranked by
 * score (already sorted by the API). Conflicted places render amber and are
 * never hidden. Replay rows — which source recorded what, and whether the
 * recording is still fetchable — are provenance detail rather than an answer,
 * so they sit in a collapsed "run details" section. They stay mounted while
 * collapsed, so nothing about a replay's availability is lost to a closed
 * panel or to the browser's in-page search.
 */
export function Dossier({
  dossier,
  brief,
}: {
  dossier: DossierData;
  /** What the run was asked, for the overlay to name — a place-detail URL is
   *  the one most likely to reach someone who never saw this page. */
  brief?: RunBriefData;
}) {
  const t = useTranslations("dossier");
  const [sort, setSort] = useState<DossierSort>({ kind: "recommended" });

  // Distances are measured against the centre the run resolved, which the
  // dossier carries so the same places can be re-measured from somewhere else
  // later without re-running anything.
  const withDistance = useMemo(
    () => placesWithDistance(dossier.places, dossier.searchCenter),
    [dossier.places, dossier.searchCenter],
  );
  const anyDistance = withDistance.some((p) => p.distanceKm !== undefined);
  const requirementOptions = useMemo(
    () => requirementSortOptions(dossier.requirements, dossier.places),
    [dossier.requirements, dossier.places],
  );
  const ordered = useMemo(() => sortPlaces(withDistance, sort), [withDistance, sort]);
  // The overlay's rank comes from the RECOMMENDED order, never from whatever
  // the reader has the sort control set to: `?place=` is a link someone can
  // send, and a rank that depends on the sender's unshared UI state would
  // read differently to whoever opens it.
  const recommended = useMemo(
    () => sortPlaces(withDistance, { kind: "recommended" }),
    [withDistance],
  );

  // The yardstick every place on this run is measured against — a property of
  // the RUN, so it is computed once here rather than per card. Per card, a
  // place the run has no coordinates for would be divided by a smaller number
  // and could show a higher percentage than the place ranked above it.
  const maxScore = useMemo(
    () =>
      maxAchievableScore(dossier.requirements, {
        withProximity: dossier.searchCenter !== undefined,
      }),
    [dossier.requirements, dossier.searchCenter],
  );

  // Which sources this dossier's OWN run actually used sample data for —
  // persisted at run time (`jobs.source_modes_json`), not derived from
  // whether a key is configured now. Never hidden, never collapsed: a
  // reopened run must keep this mark regardless of the current `.env`.
  //
  // `"fixture"` EXACTLY. No current adapter writes anything else non-live,
  // but runs from before the no-op adapters were deleted still carry
  // `"stub"` rows, and those are not sample data — nothing stood in for a
  // live result, the source simply did not run. Treating them as fixtures
  // would pin this strip open on every one of those old dossiers.
  const fixtureSources = Object.entries(dossier.sourceModes)
    .filter(([, mode]) => mode === "fixture")
    .map(([source]) => source);

  return (
    // The dossier is a scanning surface, not prose, so it is allowed more
    // width than the reading column `<main>` sets — but only once there is
    // room to spare. The breakout is on the whole SECTION rather than the
    // grid alone so the heading, the sort row and the run details stay in
    // line with the cards instead of stepping in from them. `xl` is 1280px,
    // where 64px a side still leaves a comfortable margin; below it nothing
    // moves at all.
    <Stack as="section" gap={4} className="xl:-mx-16">
      <SectionHeading
        as="h2"
        description={
          dossier.places.length > 0
            ? t("summary", { count: dossier.places.length })
            : undefined
        }
      >
        {t("title")}
      </SectionHeading>

      {fixtureSources.length > 0 ? (
        <Card
          tone="warn"
          data-testid="sample-data-strip"
          className="flex items-start gap-3"
        >
          <AlertIcon className="mt-0.5 h-4 w-4 shrink-0 text-warn-700 dark:text-warn-300" />
          <div className="text-sm leading-relaxed text-warn-900 dark:text-warn-100">
            <p className="font-semibold">{t("sampleData.title")}</p>
            <p>{t("sampleData.body", { sources: fixtureSources.join(", ") })}</p>
          </div>
        </Card>
      ) : null}

      {/* Mandatory and always visible — never inside a collapsed section. */}
      <Disclaimer className="px-1" />

      {dossier.places.length === 0 ? (
        <EmptyState className="text-sm">{t("empty")}</EmptyState>
      ) : (
        <Stack gap={4}>
          {/* Ordering, not filtering: every place stays on the page under every
              option. A list that silently shrank would make "nothing matched"
              and "nothing nearby" indistinguishable. */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-fg-subtle">
              {t("sort.count", { count: dossier.places.length })}
            </p>
            <label className="flex items-center gap-2 text-xs text-fg-muted">
              {t("sort.label")}
              <Select
                value={sortToValue(sort)}
                onChange={(e) => setSort(sortFromValue(e.target.value))}
                className="h-8 py-0 text-xs"
              >
                <option value="recommended">{t("sort.recommended")}</option>
                {anyDistance ? (
                  <option value="closest">{t("sort.closest")}</option>
                ) : null}
                {requirementOptions.map((r) => (
                  <option key={r.id} value={`requirement:${r.id}`}>
                    {t("sort.byRequirement", { requirement: r.label })}
                  </option>
                ))}
              </Select>
            </label>
          </div>
          {/* Auto-fitting columns rather than a breakpoint ladder: the number
              of columns follows the space actually available, so the same
              rule covers a phone, a split window and a wide monitor without
              anyone picking pixel values. `min(100%, 20rem)` is the part that
              makes it collapse — a bare `minmax(20rem, 1fr)` would overflow a
              viewport narrower than 20rem instead of dropping to one column.

              Grid items stretch by default and the cards are `h-full`, so
              everything in a row is the height of the tallest card in it.
              That only became the right answer once the cards stopped
              expanding in place: a card that grew used to drag its whole row
              with it, which is why this briefly used `items-start`. */}
          <div
            data-testid="dossier-grid"
            className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,20rem),1fr))]"
          >
            {ordered.map((entry, i) => (
              <DossierPlaceCard
                key={entry.place.canonicalKey ?? i}
                entry={entry}
                jobId={dossier.jobId}
                rank={i + 1}
                maxScore={maxScore > 0 ? maxScore : undefined}
              />
            ))}
          </div>
        </Stack>
      )}

      {/* Driven entirely by `?place=` — see `place-detail-overlay.tsx`. It
          renders from `dossier` directly, so opening a place costs no
          request. */}
      <PlaceDetailOverlay
        ranked={recommended}
        brief={brief}
        jobId={dossier.jobId}
        uiLocale={dossier.uiLocale}
        searchLang={dossier.searchLang}
        maxScore={maxScore > 0 ? maxScore : undefined}
      />

      <Disclosure
        summary={t("runDetails")}
        meta={
          dossier.replays.length > 0
            ? t("replay.count", { count: dossier.replays.length })
            : undefined
        }
        className="border-t border-border-subtle pt-2"
      >
        {dossier.replays.length > 0 ? (
          <Stack as="ul" gap={1}>
            {dossier.replays.map((replay) => (
              <ReplayRow
                key={replay.id}
                replay={replay}
                jobId={dossier.jobId}
                uiLocale={dossier.uiLocale}
              />
            ))}
          </Stack>
        ) : (
          <EmptyState className="px-2 py-1.5 text-xs">
            {/* `false` means the user opted out; `undefined` means the run
                predates the flag, and claiming either way would be a guess. */}
            {dossier.recordSession === false
              ? t("replayNotRecorded")
              : t("replayNone")}
          </EmptyState>
        )}
      </Disclosure>
    </Stack>
  );
}
