"use client";

import { useLocale, useTranslations } from "next-intl";
import { allergenOptions, labelOf } from "@sensitiv/shared/catalog/index";
import type { UiLocale } from "@sensitiv/shared";

export interface AllergenPickerProps {
  value: string[];
  onChange: (next: string[]) => void;
}

/** Opened by the "Food allergy" chip. Options come from the shared catalog. */
export function AllergenPicker({ value, onChange }: AllergenPickerProps) {
  const t = useTranslations("form.allergens");
  const locale = useLocale() as UiLocale;

  function toggle(id: string) {
    onChange(
      value.includes(id) ? value.filter((v) => v !== id) : [...value, id],
    );
  }

  return (
    <fieldset className="mt-2 rounded border border-gray-200 p-3 dark:border-gray-800">
      <legend className="px-1 text-sm font-medium">{t("label")}</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {allergenOptions.map((option) => (
          <label key={option.id} className="flex items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              checked={value.includes(option.id)}
              onChange={() => toggle(option.id)}
            />
            {labelOf(option, locale)}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
