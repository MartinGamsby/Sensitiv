"use client";

import { useLocale, useTranslations } from "next-intl";
import { dietOptions, labelOf } from "@sensitiv/shared/catalog/index";
import type { UiLocale } from "@sensitiv/shared";

export interface DietPickerProps {
  value: string | undefined;
  onChange: (next: string | undefined) => void;
}

/**
 * Opened by the "Special diet" chip: halal / kosher / low-FODMAP / histamine /
 * other. Same hidden-native-input pattern as `AllergenPicker`, with radios —
 * so arrow keys still move between options the way a radio group should.
 */
export function DietPicker({ value, onChange }: DietPickerProps) {
  const t = useTranslations("form.diet");
  const locale = useLocale() as UiLocale;

  return (
    <fieldset className="rounded-xl border border-border-subtle bg-surface-muted p-4">
      <legend className="px-1 text-sm font-medium text-fg">{t("label")}</legend>
      <div className="mt-2 flex flex-wrap gap-2">
        {dietOptions.map((option) => (
          <label key={option.id} className="cursor-pointer">
            <input
              type="radio"
              name="diet-option"
              className="peer sr-only"
              value={option.id}
              checked={value === option.id}
              onChange={() => onChange(option.id)}
            />
            <span className="inline-flex items-center rounded-full border border-border-strong bg-surface px-3 py-1.5 text-sm text-fg transition-colors hover:border-brand/50 peer-checked:border-brand peer-checked:bg-brand peer-checked:text-brand-fg peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[rgb(var(--ring))]">
              {labelOf(option, locale)}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
