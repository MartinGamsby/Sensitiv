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

    const body: Record<string, unknown> = {
      location: {
        query: location.query.trim(),
        ...(location.postalCode.trim() !== ""
          ? { postalCode: location.postalCode.trim() }
          : {}),
        ...(location.city ? { city: location.city } : {}),
        ...(location.region ? { region: location.region } : {}),
        ...(location.country ? { country: location.country } : {}),
        ...(location.countryName ? { countryName: location.countryName } : {}),
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

    setSubmitting(true);
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
