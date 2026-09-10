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

interface Example {
  label: string;
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

  const examples: Example[] = [
    {
      label: "Plateau-Mont-Royal, Montreal · H2T · Celiac · Auto (fr)",
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
      label: "Gluten-free brunch with a dedicated fryer — Mile End",
      apply: () => {
        setLocation({ query: "Mile End, Montreal", postalCode: "" });
        setChipIds(["celiac"]);
        setRequestText("gluten-free brunch with a dedicated fryer");
      },
    },
    {
      label: "Restaurant halal accessible en fauteuil roulant — Villeray",
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
      label: "Basement apartment with no mould history — Verdun",
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
      <div>
        <h1 className="text-xl font-semibold">{t("title")}</h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          {t("subtitle")}
        </p>
      </div>

      <LocationField value={location} onChange={setLocation} />

      <div className="flex flex-col gap-4 sm:flex-row">
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
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium" htmlFor="request-text">
          {t("request.label")}
        </label>
        <textarea
          id="request-text"
          rows={3}
          value={requestText}
          placeholder={t("request.placeholder")}
          onChange={(e) => setRequestText(e.target.value)}
          className="rounded border border-gray-300 bg-transparent px-2 py-1.5 text-sm dark:border-gray-700"
        />
        <div className="mt-1 flex flex-col gap-1">
          <span className="text-xs font-medium uppercase tracking-wide text-gray-400">
            {t("request.examples")}
          </span>
          <ul className="flex flex-col gap-1">
            {examples.map((ex) => (
              <li key={ex.label}>
                <button
                  type="button"
                  onClick={ex.apply}
                  className="text-left text-xs text-blue-700 hover:underline dark:text-blue-400"
                >
                  {ex.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <RequirementChips
        value={chipIds}
        onChange={setChipIds}
        allergens={allergens}
        onAllergensChange={setAllergens}
        diet={diet}
        onDietChange={setDiet}
      />

      <SolariKeyField onChange={setSolariKey} />

      {errorKey ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {t(`errors.${errorKey}`)}
        </p>
      ) : null}

      <div>
        <button
          type="submit"
          disabled={submitting}
          className="rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60 dark:bg-gray-100 dark:text-gray-900"
        >
          {submitting ? t("submitting") : t("submit")}
        </button>
      </div>
    </form>
  );
}
