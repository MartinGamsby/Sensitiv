"use client";

import { useLocale, useTranslations } from "next-intl";
import { getRequirement, labelOf } from "@sensitiv/shared/catalog/index";
import type { UiLocale } from "@sensitiv/shared";
import { AllergenPicker } from "./allergen-picker.tsx";
import { DietPicker } from "./diet-picker.tsx";

// Exactly these five in v1, in this order. Labels are pulled from the shared
// catalog — never re-typed here.
export const CHIP_IDS = ["celiac", "allergy", "mold", "diet", "access"] as const;

export interface RequirementChipsProps {
  value: string[];
  onChange: (ids: string[]) => void;
  allergens: string[];
  onAllergensChange: (next: string[]) => void;
  diet: string | undefined;
  onDietChange: (next: string | undefined) => void;
}

export function RequirementChips({
  value,
  onChange,
  allergens,
  onAllergensChange,
  diet,
  onDietChange,
}: RequirementChipsProps) {
  const t = useTranslations("form.chips");
  const locale = useLocale() as UiLocale;

  function toggle(id: string) {
    const selected = value.includes(id);
    const next = selected
      ? value.filter((v) => v !== id)
      : CHIP_IDS.filter((c) => c === id || value.includes(c));
    onChange([...next]);
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium">{t("label")}</span>
      <div className="flex flex-wrap gap-2">
        {CHIP_IDS.map((id) => {
          const active = value.includes(id);
          return (
            <button
              key={id}
              type="button"
              aria-pressed={active}
              onClick={() => toggle(id)}
              className={
                "rounded-full border px-3 py-1 text-sm transition " +
                (active
                  ? "border-gray-900 bg-gray-900 text-white dark:border-gray-100 dark:bg-gray-100 dark:text-gray-900"
                  : "border-gray-300 text-gray-700 hover:border-gray-500 dark:border-gray-700 dark:text-gray-300")
              }
            >
              {labelOf(getRequirement(id), locale)}
            </button>
          );
        })}
      </div>

      {value.includes("allergy") ? (
        <AllergenPicker value={allergens} onChange={onAllergensChange} />
      ) : null}
      {value.includes("diet") ? (
        <DietPicker value={diet} onChange={onDietChange} />
      ) : null}
    </div>
  );
}
