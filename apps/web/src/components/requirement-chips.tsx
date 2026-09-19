"use client";

import type { ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  defaultIntentsFor,
  getIntent,
  getRequirement,
  labelOf,
} from "@sensitiv/shared/catalog/index";
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
  /** Per chip, which of its catalog intents to search. See `IntentPicker`. */
  intents: Record<string, string[]>;
  onIntentsChange: (next: Record<string, string[]>) => void;
  allergens: string[];
  onAllergensChange: (next: string[]) => void;
  diet: string | undefined;
  onDietChange: (next: string | undefined) => void;
}

/**
 * Where a requirement should be searched, as a question the form asks out loud.
 *
 * A chip's catalog `intents` list what it COULD apply to — `celiac` is both
 * `dining` and `grocery` — and for a long time ticking the chip searched every
 * one of them. So "Mexican restaurant" + celiac also ran "gluten free grocery
 * store", and a grocery store and a pastry shop landed in the top three of a
 * restaurant search. The planner was supposed to narrow that from the free
 * text and structurally could not.
 *
 * So it is asked instead of inferred. Starts on the chip's first intent
 * (`defaultIntentsFor`), and a chip with only one intent renders nothing —
 * there is no question to ask.
 */
function IntentPicker({
  requirementId,
  value,
  onChange,
  locale,
  label,
}: {
  requirementId: string;
  value: string[];
  onChange: (next: string[]) => void;
  locale: UiLocale;
  label: string;
}) {
  const requirement = getRequirement(requirementId);
  const options = requirement?.intents ?? [];
  if (options.length < 2) return null;

  function toggle(intentId: string) {
    const next = options.filter((id) =>
      id === intentId ? !value.includes(id) : value.includes(id),
    );
    // Never let the last one off: a requirement with nowhere to look is not a
    // narrower search, it is a chip that silently does nothing.
    onChange(next.length > 0 ? [...next] : value);
  }

  return (
    <div className="flex flex-wrap items-center gap-2 pl-1">
      <span className="text-xs font-medium text-fg-subtle">{label}</span>
      {options.map((intentId) => {
        const active = value.includes(intentId);
        return (
          <button
            key={intentId}
            type="button"
            aria-pressed={active}
            onClick={() => toggle(intentId)}
            className={cn(
              "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
              active
                ? "border-brand bg-brand-soft text-brand-soft-fg"
                : "border-border-subtle bg-surface text-fg-muted hover:border-brand/50",
            )}
          >
            {labelOf(getIntent(intentId), locale)}
          </button>
        );
      })}
    </div>
  );
}

export function RequirementChips({
  value,
  onChange,
  intents,
  onIntentsChange,
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
    // Seed the chip's intents the moment it is ticked, so the value the form
    // submits is always the one on screen — never an implicit default the user
    // never saw. Un-ticking drops the entry rather than keeping a stale one.
    if (selected) {
      const rest = { ...intents };
      delete rest[id];
      onIntentsChange(rest);
    } else if (!intents[id]) {
      onIntentsChange({ ...intents, [id]: defaultIntentsFor(id) });
    }
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

      {/* One row per active chip that has a choice to make. With several of
          them the shared "Where should we look?" heading stops being an answer
          to anything, so each row names its own requirement instead. */}
      {(() => {
        const asking = CHIP_IDS.filter(
          (id) => value.includes(id) && (getRequirement(id)?.intents.length ?? 0) > 1,
        );
        return asking.map((id) => (
          <IntentPicker
            key={id}
            requirementId={id}
            value={intents[id] ?? defaultIntentsFor(id)}
            onChange={(next) => onIntentsChange({ ...intents, [id]: next })}
            locale={locale}
            label={
              asking.length > 1
                ? `${labelOf(getRequirement(id), locale)}:`
                : t("whereLabel")
            }
          />
        ));
      })()}

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
