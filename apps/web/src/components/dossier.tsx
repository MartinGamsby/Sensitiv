"use client";

import { useTranslations } from "next-intl";
import type { Dossier as DossierData } from "@sensitiv/shared";
import { Disclaimer } from "./disclaimer.tsx";
import { DossierPlaceCard } from "./dossier-place-card.tsx";

/**
 * The dossier: the mandatory disclaimer, then one card per place ranked by
 * score (already sorted by the API). Conflicted places render amber and are
 * never hidden. Replay links show when present; otherwise a muted note.
 */
export function Dossier({ dossier }: { dossier: DossierData }) {
  const t = useTranslations("dossier");

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">{t("title")}</h2>

      <div className="rounded border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-900">
        <Disclaimer />
      </div>

      {dossier.places.length === 0 ? (
        <p className="text-sm text-gray-500">{t("empty")}</p>
      ) : (
        <div className="flex flex-col gap-4">
          {dossier.places.map((entry, i) => (
            <DossierPlaceCard
              key={entry.place.canonicalKey ?? i}
              entry={entry}
              uiLocale={dossier.uiLocale}
              searchLang={dossier.searchLang}
            />
          ))}
        </div>
      )}

      <div className="text-xs text-gray-500">
        {dossier.replayUrls.length > 0 ? (
          <ul className="flex flex-col gap-1">
            {dossier.replayUrls.map((url) => (
              <li key={url}>
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  {t("replayUrl")}
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="italic">{t("replayNone")}</p>
        )}
      </div>
    </section>
  );
}
