"use client";

import type { ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { getRequirement, labelOf } from "@sensitiv/shared/catalog/index";
import type { UiLocale } from "@sensitiv/shared";
import { AllergenPicker } from "./allergen-picker.tsx";
import { DietPicker } from "./diet-picker.tsx";
import {
  AccessIcon,
  CheckIcon,
  DropletIcon,
  LeafIcon,
  PeanutIcon,
  WheatIcon,
} from "./ui/icon.tsx";
import { cn } from "@/lib/cn.ts";

// Exactly these five in v1, in this order. Labels are pulled from the shared
// catalog — never re-typed here.
export const CHIP_IDS = ["celiac", "allergy", "mold", "diet", "access"] as const;

// Presentation only: a glyph per catalog id, so the five requirements are
// distinguishable at a glance instead of being five identical pills. The
// catalog stays the source of truth for which ids exist and what they're
// called — an id with no entry here simply renders without a glyph.
const CHIP_ICON: Record<string, ReactNode> = {
  celiac: <WheatIcon className="h-5 w-5" />,
  allergy: <PeanutIcon className="h-5 w-5" />,
  mold: <DropletIcon className="h-5 w-5" />,
  diet: <LeafIcon className="h-5 w-5" />,
  access: <AccessIcon className="h-5 w-5" />,
};

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
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {CHIP_IDS.map((id) => {
          const active = value.includes(id);
          return (
            <button
              key={id}
              type="button"
              aria-pressed={active}
              onClick={() => toggle(id)}
              className={cn(
                "group relative flex items-center gap-2.5 rounded-xl border p-3 text-left text-sm font-medium transition-all",
                active
                  ? "border-brand bg-brand-soft text-brand-soft-fg shadow-card"
                  : "border-border-subtle bg-surface text-fg hover:border-brand/50 hover:bg-surface-muted",
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "shrink-0 transition-colors",
                  active ? "text-brand" : "text-fg-subtle group-hover:text-brand/70",
                )}
              >
                {CHIP_ICON[id]}
              </span>
              <span className="min-w-0 leading-tight">
                {labelOf(getRequirement(id), locale)}
              </span>
              {/* Selection is already carried by `aria-pressed`; this is the
                  visual echo of it, so it stays out of the accessible name. */}
              <CheckIcon
                className={cn(
                  "ml-auto h-4 w-4 shrink-0 text-brand transition-opacity",
                  active ? "opacity-100" : "opacity-0",
                )}
              />
            </button>
          );
        })}
      </div>

      {value.includes("allergy") ? (
        <div className="animate-fade-in-up">
          <AllergenPicker value={allergens} onChange={onAllergensChange} />
        </div>
      ) : null}
      {value.includes("diet") ? (
        <div className="animate-fade-in-up">
          <DietPicker value={diet} onChange={onDietChange} />
        </div>
      ) : null}

      {value.length === 0 ? (
        <p className="text-xs text-fg-subtle">{t("hint")}</p>
      ) : null}
    </div>
  );
}
