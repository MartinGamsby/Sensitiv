"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { SearchLanguage, UiLocale } from "@sensitiv/shared";
import { useRouter } from "@/i18n/navigation.ts";
import { LocationField, type LocationDraft } from "./location-field.tsx";
import { LanguageCombobox } from "./language-combobox.tsx";
import { TimeoutCombobox } from "./timeout-combobox.tsx";
import { RequirementChips } from "./requirement-chips.tsx";
import { SolariKeyField } from "./solari-key-field.tsx";
import {
  Button,
  Card,
  Disclosure,
  Field,
  SectionHeading,
  Spinner,
  Textarea,
} from "./ui/index.ts";
import { ClockIcon, SearchIcon, SlidersIcon } from "./ui/icon.tsx";

/**
 * A one-click starting point. The label lives in `messages/*.json` under
 * `form.presets.<id>` so it reads in the user's UI locale; the values it
 * applies are data and stay here.
 */
interface Preset {
  id: string;
  apply: () => void;
}

const EMPTY_LOCATION: LocationDraft = { query: "", postalCode: "" };

/**
 * Best-effort forward geocode of whatever the user typed.
 *
 * Returns the draft UNCHANGED on any miss or failure. That is the contract:
 * coordinates are an optimisation, not a requirement, and OpenStreetMap has no
 * Canadian postal-code data at all, so a Montreal FSA legitimately resolves to
 * nothing here. The worker anchors the search on its own either way.
 */
async function resolveLocation(draft: LocationDraft): Promise<LocationDraft> {
  const query = draft.query.trim();
  if (query === "") return draft;
  try {
    const params = new URLSearchParams({ q: query });
    if (draft.country) params.set("country", draft.country);
    const res = await fetch(`/api/geocode?${params.toString()}`);
    if (!res.ok) return draft;
    const body = (await res.json()) as {
      location?: {
        city?: string | null;
        region?: string | null;
        country?: string | null;
        countryName?: string | null;
        lat?: number | null;
        lng?: number | null;
      } | null;
    };
    const loc = body.location;
    if (!loc) return draft;
    // Coordinates may be absent even on a hit: the route withholds them for a
    // match too coarse to search (it answers "Quebec, Canada" with the whole
    // province). The structured fields are still worth keeping.
    const hasCoords = typeof loc.lat === "number" && typeof loc.lng === "number";
    return {
      ...draft,
      // Only fill gaps: anything the user or a previous geocode already set
      // stays put.
      city: draft.city ?? loc.city ?? undefined,
      region: draft.region ?? loc.region ?? undefined,
      country: draft.country ?? loc.country ?? undefined,
      countryName: draft.countryName ?? loc.countryName ?? undefined,
      ...(hasCoords ? { lat: loc.lat as number, lng: loc.lng as number } : {}),
    };
  } catch {
    return draft;
  }
}

export function RunForm() {
  const t = useTranslations("form");
  const locale = useLocale() as UiLocale;
  const router = useRouter();

  const [location, setLocation] = useState<LocationDraft>(EMPTY_LOCATION);
  const [searchLang, setSearchLang] = useState<SearchLanguage | null>(null);
  const [timeoutSec, setTimeoutSec] = useState(480);
  const [saveAsDefault, setSaveAsDefault] = useState(false);
  const [requestText, setRequestText] = useState("");
  const [chipIds, setChipIds] = useState<string[]>([]);
  const [allergens, setAllergens] = useState<string[]>([]);
  const [diet, setDiet] = useState<string | undefined>(undefined);
  const [solariKey, setSolariKey] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorKey, setErrorKey] = useState<
    "locationRequired" | "nothingToSearch" | "submitFailed" | null
  >(null);

  const presets: Preset[] = [
    {
      id: "celiacPlateau",
      apply: () => {
        setLocation({
          query: "Plateau-Mont-Royal, Montreal",
          postalCode: "H2T",
          region: "Quebec",
          country: "CA",
        });
        setSearchLang(null);
        setChipIds(["celiac"]);
        setRequestText("");
        setAllergens([]);
        setDiet(undefined);
      },
    },
    {
      id: "gfBrunch",
      apply: () => {
        setLocation({ query: "Mile End, Montreal", postalCode: "" });
        setChipIds(["celiac"]);
        setRequestText("gluten-free brunch with a dedicated fryer");
      },
    },
    {
      id: "halalAccess",
      apply: () => {
        setLocation({
          query: "Villeray, Montréal",
          postalCode: "",
          region: "Quebec",
          country: "CA",
        });
        setChipIds(["diet", "access"]);
        setDiet("halal");
        setRequestText("restaurant halal avec entrée sans marche");
      },
    },
    {
      id: "moldVerdun",
      apply: () => {
        setLocation({ query: "Verdun, Montreal", postalCode: "" });
        setChipIds(["mold"]);
        setRequestText("basement apartment, no history of mould or leaks");
      },
    },
  ];

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorKey(null);

    if (location.query.trim() === "") {
      setErrorKey("locationRequired");
      return;
    }
    if (requestText.trim() === "" && chipIds.length === 0) {
      setErrorKey("nothingToSearch");
      return;
    }

    setSubmitting(true);

    // Resolve the typed text to coordinates before enqueuing, so the job
    // carries a map point and not just a place NAME. Best effort by design:
    // OpenStreetMap cannot resolve a Canadian postal code at all, and a miss
    // here is not an error — the worker still anchors the search itself via
    // Google Maps. What this buys is a filled-in `city` and one less page load.
    const resolved = location.lat !== undefined && location.lng !== undefined
      ? location
      : await resolveLocation(location);

    const body: Record<string, unknown> = {
      location: {
        query: resolved.query.trim(),
        ...(resolved.postalCode.trim() !== ""
          ? { postalCode: resolved.postalCode.trim() }
          : {}),
        ...(resolved.city ? { city: resolved.city } : {}),
        ...(resolved.region ? { region: resolved.region } : {}),
        ...(resolved.country ? { country: resolved.country } : {}),
        ...(resolved.countryName ? { countryName: resolved.countryName } : {}),
        ...(resolved.lat !== undefined ? { lat: resolved.lat } : {}),
        ...(resolved.lng !== undefined ? { lng: resolved.lng } : {}),
      },
      requestText: requestText.trim(),
      chipIds,
      ...(allergens.length > 0 ? { allergens } : {}),
      ...(diet ? { diet } : {}),
      searchLang: searchLang ? searchLang.code : null,
      uiLocale: locale,
      timeoutSec,
      ...(saveAsDefault ? { saveAsDefault: true } : {}),
      ...(solariKey.trim() !== "" ? { solariKey: solariKey.trim() } : {}),
    };

    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`POST /api/jobs ${res.status}`);
      const data = (await res.json()) as { jobId?: string };
      if (!data.jobId) throw new Error("no jobId in response");
      router.push(`/jobs/${data.jobId}`);
    } catch {
      setSubmitting(false);
      setErrorKey("submitFailed");
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      <header className="max-w-2xl">
        <h1 className="text-2xl font-semibold tracking-tight text-fg sm:text-3xl">
          {t("title")}
        </h1>
        <p className="mt-2 text-base leading-relaxed text-fg-muted">
          {t("subtitle")}
        </p>
      </header>

      {/* Step 1 — where */}
      <Card padding="lg" className="flex flex-col gap-4">
        <SectionHeading eyebrow="1" as="h2">
          {t("steps.where")}
        </SectionHeading>
        <LocationField value={location} onChange={setLocation} />
      </Card>

      {/* Step 2 — requirements */}
      <Card padding="lg" className="flex flex-col gap-4">
        <SectionHeading
          eyebrow="2"
          as="h2"
          description={t("chips.description")}
        >
          {t("chips.label")}
        </SectionHeading>
        <RequirementChips
          value={chipIds}
          onChange={setChipIds}
          allergens={allergens}
          onAllergensChange={setAllergens}
          diet={diet}
          onDietChange={setDiet}
        />
      </Card>

      {/* Step 3 — free-text request + one-click presets */}
      <Card padding="lg" className="flex flex-col gap-4">
        <SectionHeading
          eyebrow="3"
          as="h2"
          description={t("request.description")}
        >
          {t("request.label")}
        </SectionHeading>

        <Field htmlFor="request-text" label={t("request.fieldLabel")} adornment={t("optional")}>
          <Textarea
            id="request-text"
            rows={3}
            value={requestText}
            placeholder={t("request.placeholder")}
            onChange={(e) => setRequestText(e.target.value)}
          />
        </Field>

        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-fg-subtle">
            {t("request.examples")}
          </span>
          <div className="grid gap-2 sm:grid-cols-2">
            {presets.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={preset.apply}
                className="group flex items-start gap-2.5 rounded-xl border border-border-subtle bg-surface-muted p-3 text-left transition-all hover:border-brand/50 hover:bg-surface hover:shadow-card"
              >
                <SearchIcon className="mt-0.5 h-4 w-4 shrink-0 text-fg-subtle transition-colors group-hover:text-brand" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium leading-snug text-fg">
                    {t(`presets.${preset.id}.title`)}
                  </span>
                  <span className="mt-0.5 block text-xs text-fg-muted">
                    {t(`presets.${preset.id}.where`)}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
      </Card>

      {/* Everything a first run never needs to touch. */}
      <Disclosure
        summary={
          <span className="inline-flex items-center gap-2">
            <SlidersIcon className="h-4 w-4" />
            {t("advanced")}
          </span>
        }
        triggerClassName="px-1"
        contentClassName="pt-3"
      >
        <Card padding="lg" tone="muted" className="grid gap-4 sm:grid-cols-2">
          <LanguageCombobox
            location={{ region: location.region, country: location.country }}
            value={searchLang}
            onChange={setSearchLang}
          />
          <TimeoutCombobox
            value={timeoutSec}
            onChange={setTimeoutSec}
            saveAsDefault={saveAsDefault}
            onSaveAsDefaultChange={setSaveAsDefault}
          />
        </Card>
      </Disclosure>

      {/* Only renders at all when the server has no Solari key of its own, so
          it stays out of the collapsed section — it is the one setting a user
          in that state actually has to find. */}
      <SolariKeyField onChange={setSolariKey} />

      <Card
        tone="brand"
        padding="lg"
        className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="flex items-start gap-2.5 text-sm text-brand-soft-fg">
          <ClockIcon className="mt-0.5 h-4 w-4 shrink-0" />
          <p className="leading-relaxed">
            {t("submitNote", { minutes: Math.round(timeoutSec / 60) })}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-stretch gap-2 sm:items-end">
          <Button
            type="submit"
            variant="primary"
            size="lg"
            disabled={submitting}
            icon={submitting ? <Spinner /> : <SearchIcon className="h-5 w-5" />}
          >
            {submitting ? t("submitting") : t("submit")}
          </Button>
        </div>
      </Card>

      {errorKey ? (
        <p
          role="alert"
          className="rounded-lg bg-danger-50 px-3 py-2 text-sm font-medium text-danger-700 dark:bg-danger-950/60 dark:text-danger-300"
        >
          {t(`errors.${errorKey}`)}
        </p>
      ) : null}
    </form>
  );
}
