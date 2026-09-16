"use client";

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  resolveSearchLanguage,
  type Location,
  type SearchLanguage,
} from "@sensitiv/shared";
import { Field, Select } from "./ui/index.ts";

const BASE_CODES = ["en", "fr", "es", "de", "it", "pt", "nl"] as const;

export interface LanguageComboboxProps {
  /** Region/country drive the `Auto` resolution. */
  location: Pick<Location, "region" | "country">;
  /** `null` (or `source: "auto"`) => the Auto option is selected. */
  value: SearchLanguage | null;
  onChange: (next: SearchLanguage | null) => void;
}

export function LanguageCombobox({
  location,
  value,
  onChange,
}: LanguageComboboxProps) {
  const t = useTranslations("form.searchLanguage");
  const uiLocale = useLocale();

  const resolved = useMemo(
    () => resolveSearchLanguage(location),
    [location.region, location.country],
  );

  const codes = useMemo(() => {
    const set = new Set<string>(BASE_CODES);
    set.add(resolved.code);
    return [...set];
  }, [resolved.code]);

  const displayName = useMemo(() => {
    try {
      return new Intl.DisplayNames([uiLocale], { type: "language" });
    } catch {
      return undefined;
    }
  }, [uiLocale]);

  const selectValue =
    value && value.source === "user" ? value.code : "auto";

  return (
    <Field
      htmlFor="search-language-select"
      label={t("label")}
      hint={t("hint")}
    >
      <Select
        id="search-language-select"
        value={selectValue}
        onChange={(e) => {
          const next = e.target.value;
          if (next === "auto") {
            onChange(null);
          } else {
            onChange({ code: next, source: "user" });
          }
        }}
      >
        <option value="auto">{t("autoResolved", { code: resolved.code })}</option>
        {codes.map((code) => (
          <option key={code} value={code}>
            {displayName?.of(code) ?? code.toUpperCase()}
          </option>
        ))}
      </Select>
    </Field>
  );
}
