"use client";

import { useLocale, useTranslations } from "next-intl";
import { allergenOptions, labelOf } from "@sensitiv/shared/catalog/index";
import type { UiLocale } from "@sensitiv/shared";

export interface AllergenPickerProps {
  value: string[];
  onChange: (next: string[]) => void;
}

/**
 * Opened by the "Food allergy" chip. Options come from the shared catalog.
 *
 * Each option is a real `<input type="checkbox">` wrapped in its `<label>` —
 * the input is visually hidden (`sr-only`) rather than replaced by a `<button>`
 * so the control keeps native checkbox semantics, keyboard behaviour and
 * label association; the `peer-*` classes paint the chip around it.
 */
export function AllergenPicker({ value, onChange }: AllergenPickerProps) {
  const t = useTranslations("form.allergens");
  const locale = useLocale() as UiLocale;

  function toggle(id: string) {
    onChange(
      value.includes(id) ? value.filter((v) => v !== id) : [...value, id],
    );
  }

  return (
    <fieldset className="rounded-xl border border-border-subtle bg-surface-muted p-4">
      <legend className="px-1 text-sm font-medium text-fg">{t("label")}</legend>
      <div className="mt-2 flex flex-wrap gap-2">
        {allergenOptions.map((option) => (
          <label key={option.id} className="cursor-pointer">
            <input
              type="checkbox"
              className="peer sr-only"
              checked={value.includes(option.id)}
              onChange={() => toggle(option.id)}
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
