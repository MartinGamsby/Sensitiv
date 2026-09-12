"use client";

import { useFormatter, useTranslations } from "next-intl";
import type { Dossier as DossierData, DossierReplay } from "@sensitiv/shared";
import { Disclaimer } from "./disclaimer.tsx";
import { DossierPlaceCard, safeExternalHref } from "./dossier-place-card.tsx";
import { Card, EmptyState, MetaRow, Stack } from "./ui/index.ts";

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
          className="underline"
        >
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
              className="underline"
            >
              {t("replayUrl")}
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
    case "unavailable":
    default:
      availability = <span className="italic">{t("replay.unavailable")}</span>;
      break;
  }

  return (
    <li>
      <MetaRow
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
 * never hidden. One row per recorded replay, each showing its source, what it
 * contributed, and an honest availability state; the old flat "Replay this
 * run" list is gone along with it — `replayUrls` no longer exists on the
 * dossier.
 */
export function Dossier({ dossier }: { dossier: DossierData }) {
  const t = useTranslations("dossier");

  // Which sources this dossier's OWN run actually used sample data for —
  // persisted at run time (`jobs.source_modes_json`), not derived from
  // whether a key is configured now. Never hidden: a reopened run must keep
  // this mark regardless of the current `.env`.
  const fixtureSources = Object.entries(dossier.sourceModes)
    .filter(([, mode]) => mode === "fixture")
    .map(([source]) => source);

  return (
    <Stack as="section" gap={4}>
      <h2 className="text-lg font-semibold">{t("title")}</h2>

      <Card tone="muted" className="rounded p-3">
        <Disclaimer />
      </Card>

      {fixtureSources.length > 0 ? (
        <Card
          tone="warn"
          data-testid="sample-data-strip"
          className="rounded border-warn-300 bg-warn-50 px-3 py-2 text-sm text-warn-900 dark:border-warn-800 dark:bg-warn-950 dark:text-warn-100"
        >
          <p className="font-medium">{t("sampleData.title")}</p>
          <p>{t("sampleData.body", { sources: fixtureSources.join(", ") })}</p>
        </Card>
      ) : null}

      {dossier.places.length === 0 ? (
        <EmptyState className="text-sm">{t("empty")}</EmptyState>
      ) : (
        <Stack gap={4}>
          {dossier.places.map((entry, i) => (
            <DossierPlaceCard
              key={entry.place.canonicalKey ?? i}
              entry={entry}
              uiLocale={dossier.uiLocale}
              searchLang={dossier.searchLang}
            />
          ))}
        </Stack>
      )}

      <div>
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
          <EmptyState className="text-xs">{t("replayNone")}</EmptyState>
        )}
      </div>
    </Stack>
  );
}
