"use client";

import { useFormatter, useLocale, useTranslations } from "next-intl";
import { getRequirement, labelOf } from "@sensitiv/shared/catalog/index";
import type { PlannedRequirement, UiLocale } from "@sensitiv/shared";
import { Badge } from "./ui/index.ts";
import { ClockIcon, CrosshairIcon, MapIcon, PinIcon, SearchIcon } from "./ui/icon.tsx";
import { humanizeRequirementId } from "./dossier-place-card.tsx";
import { formatCoords, runHeadline, type RunBriefData } from "@/lib/run-brief.ts";
import { languageName } from "@/lib/language-name.ts";
import { cn } from "@/lib/cn.ts";

/**
 * A requirement's display name.
 *
 * The catalog wins for an id it knows, so the label follows the reader's
 * locale rather than the locale the run was created in. The stored `label`
 * is the fallback because the planner mints ad-hoc requirements per run
 * (`custom_mexican_restaurant`) that the catalog has never heard of.
 */
export function requirementLabel(
  requirement: PlannedRequirement,
  locale: UiLocale,
): string {
  return (
    labelOf(getRequirement(requirement.catalogId ?? requirement.id), locale) ||
    requirement.label ||
    humanizeRequirementId(requirement.id)
  );
}

/**
 * The requirements a run checked, as badges.
 *
 * Shown wherever a run is identified, because "italian in Montreal" and
 * "italian in Montreal, celiac-safe" are different questions with different
 * answers, and only one of them was on screen before.
 */
export function RequirementBadges({
  requirements,
  className,
}: {
  requirements: PlannedRequirement[];
  className?: string;
}) {
  const locale = useLocale() as UiLocale;
  if (requirements.length === 0) return null;
  return (
    <ul className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {requirements.map((r) => (
        <li key={r.id}>
          <Badge tone="brand" data-testid="requirement-badge">
            {requirementLabel(r, locale)}
          </Badge>
        </li>
      ))}
    </ul>
  );
}

/**
 * One line naming the run — subject, requirements, place.
 *
 * For contexts that already have a heading of their own and only need to say
 * which run this is: the place-detail overlay, whose URL is the one most
 * likely to be sent to someone who has never seen the dossier it came from.
 */
export function RunBriefLine({ brief }: { brief: RunBriefData }) {
  const locale = useLocale() as UiLocale;
  const headline = runHeadline(brief);
  const parts = [
    headline,
    ...brief.requirements.map((r) => requirementLabel(r, locale)),
  ].filter((p): p is string => p !== undefined && p !== "");

  return (
    <p
      data-testid="run-brief-line"
      className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-fg-muted"
    >
      <SearchIcon className="h-3.5 w-3.5 shrink-0 text-fg-subtle" />
      <span className="font-medium text-fg">{parts.join(" · ")}</span>
      <span aria-hidden="true">·</span>
      <PinIcon className="h-3 w-3 shrink-0" />
      <span>{brief.location.query}</span>
    </p>
  );
}

/**
 * The run's question, above its answer.
 *
 * Everything here was already on the job row and none of it was on the page:
 * a reader arriving at `/jobs/<uuid>` — their own bookmark, or a link
 * someone sent them — saw "Research run" and a list of restaurants, with no
 * way to know what had been asked or which requirements had been checked.
 */
export function RunBrief({ brief }: { brief: RunBriefData }) {
  const t = useTranslations("run");
  const format = useFormatter();
  const locale = useLocale() as UiLocale;
  const headline = runHeadline(brief);
  const { location } = brief;
  const created = new Date(brief.createdAt);

  // A pin the user dropped is a different claim from a place name we
  // geocoded, and the difference is worth a word: it is the most precise
  // thing the form can capture, and it overrides every lookup downstream.
  const pinned = location.pinned === true && location.lat !== undefined &&
    location.lng !== undefined;
  // Where the adapters actually ended up. Usually the same neighbourhood the
  // text names, but a postal code is re-resolved by the Maps hop, so this can
  // be the only honest answer to "around where?".
  const centre = brief.searchCenter;

  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-2xl font-semibold tracking-tight text-fg">
        {headline ?? t("title")}
      </h1>

      <RequirementBadges requirements={brief.requirements} />

      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-fg-muted">
        <li className="flex items-center gap-1.5">
          <PinIcon className="h-3.5 w-3.5 shrink-0 text-fg-subtle" />
          <span className="font-medium text-fg">{location.query}</span>
          {location.postalCode ? <span>({location.postalCode})</span> : null}
        </li>

        <li className="flex items-center gap-1.5">
          <MapIcon className="h-3.5 w-3.5 shrink-0 text-fg-subtle" />
          {t("brief.radius", { km: location.radiusKm })}
        </li>

        {/* Only when there is something to say that the line above does not
            already say. A run whose centre was never resolved says nothing
            rather than implying it searched the text verbatim. */}
        {pinned || centre ? (
          <li
            className="flex items-center gap-1.5"
            data-testid="run-brief-centre"
            title={centre ? formatCoords(centre) : undefined}
          >
            <CrosshairIcon className="h-3.5 w-3.5 shrink-0 text-fg-subtle" />
            {pinned
              ? t("brief.pinned", {
                  coords: formatCoords({
                    lat: location.lat!,
                    lng: location.lng!,
                  }),
                })
              : t("brief.centre", { coords: formatCoords(centre!) })}
          </li>
        ) : null}

        <li className="flex items-center gap-1.5">
          <SearchIcon className="h-3.5 w-3.5 shrink-0 text-fg-subtle" />
          {t("brief.searchedIn", {
            lang: languageName(brief.searchLang, locale),
          })}
        </li>

        <li className="flex items-center gap-1.5">
          <ClockIcon className="h-3.5 w-3.5 shrink-0 text-fg-subtle" />
          <time dateTime={created.toISOString()} title={created.toISOString()}>
            {format.dateTime(created, { dateStyle: "medium", timeStyle: "short" })}
          </time>
        </li>
      </ul>
    </div>
  );
}
