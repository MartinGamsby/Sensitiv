"use client";

import { useLocale, useTranslations } from "next-intl";
import { dietOptions, labelOf } from "@sensitiv/shared/catalog/index";
import type { UiLocale } from "@sensitiv/shared";

export interface DietPickerProps {
  value: string | undefined;
  onChange: (next: string | undefined) => void;
}

/** Opened by the "Special diet" chip: halal / kosher / low-FODMAP / histamine / other. */
export function DietPicker({ value, onChange }: DietPickerProps) {
  const t = useTranslations("form.diet");
  const locale = useLocale() as UiLocale;

  return (
    <fieldset className="mt-2 rounded border border-gray-200 p-3 dark:border-gray-800">
      <legend className="px-1 text-sm font-medium">{t("label")}</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {dietOptions.map((option) => (
          <label key={option.id} className="flex items-center gap-1.5 text-sm">
            <input
              type="radio"
              name="diet-option"
              value={option.id}
              checked={value === option.id}
              onChange={() => onChange(option.id)}
            />
            {labelOf(option, locale)}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
