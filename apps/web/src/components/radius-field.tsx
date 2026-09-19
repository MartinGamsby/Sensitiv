"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  DEFAULT_RADIUS_KM,
  MAX_RADIUS_KM,
  MIN_RADIUS_KM,
} from "@sensitiv/shared";
import { Field, Input } from "./ui/index.ts";
import { cn } from "@/lib/cn.ts";

/**
 * One-click radii. Still here after the field became free-entry, because
 * these four cover almost every run and a preset is faster than typing — but
 * they are now shortcuts into a continuous range, not the whole range.
 */
export const RADIUS_PRESETS_KM = [1, 3, 5, 10] as const;

/** Round to the step the input offers, so 2.7000000000000002 never reaches
 *  the job row. */
function quantise(km: number): number {
  return Math.round(km * 10) / 10;
}

export function clampRadius(km: number): number {
  return quantise(Math.min(MAX_RADIUS_KM, Math.max(MIN_RADIUS_KM, km)));
}

export interface RadiusFieldProps {
  /** `undefined` means the draft has not set one; the default is shown. */
  value: number | undefined;
  onChange: (km: number) => void;
  className?: string;
}

/**
 * The search radius: any number, not four of them.
 *
 * This was a `<select>` over `[1, 3, 5, 10]`, which is fine until the answer
 * is 2 — a walkable neighbourhood is not one of four sizes. It is now a
 * number input over a continuous range, with those four kept as quick picks.
 *
 * The text is held in local state rather than driven straight off `value`,
 * because a controlled numeric input that commits every keystroke cannot be
 * cleared or retyped: emptying it parses as `0`, which the schema rejects,
 * and "10" cannot become "2" without passing through the empty string. So
 * typing is free, only a valid in-range number is committed, and leaving the
 * field settles whatever is left — clamping an out-of-range number and
 * restoring the last good one if the box is empty or nonsense.
 */
export function RadiusField({ value, onChange, className }: RadiusFieldProps) {
  const t = useTranslations("form.radius");
  const committed = value ?? DEFAULT_RADIUS_KM;
  const [text, setText] = useState(String(committed));

  // Follow the draft when something else changes it — a preset, or the form
  // being reset. Skipped while the text already means this number, so it
  // cannot overwrite what the reader is mid-way through typing.
  useEffect(() => {
    // `text` is read but deliberately not a dependency: this syncs FROM the
    // committed value, and listing it would re-run on every keystroke.
    setText((current) =>
      Number.parseFloat(current) === committed ? current : String(committed),
    );
  }, [committed]);

  function commitText(next: string) {
    setText(next);
    const parsed = Number.parseFloat(next);
    if (!Number.isFinite(parsed)) return;
    if (parsed < MIN_RADIUS_KM || parsed > MAX_RADIUS_KM) return;
    onChange(quantise(parsed));
  }

  function settle() {
    const parsed = Number.parseFloat(text);
    if (!Number.isFinite(parsed)) {
      setText(String(committed));
      return;
    }
    const clamped = clampRadius(parsed);
    setText(String(clamped));
    if (clamped !== committed) onChange(clamped);
  }

  return (
    <Field
      htmlFor="location-radius"
      label={t("label")}
      hint={t("hint")}
      className={className}
    >
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Input
            id="location-radius"
            type="number"
            inputMode="decimal"
            min={MIN_RADIUS_KM}
            max={MAX_RADIUS_KM}
            step={0.5}
            value={text}
            onChange={(e) => commitText(e.target.value)}
            onBlur={settle}
            className="w-24"
          />
          <span className="text-sm text-fg-muted">{t("unit")}</span>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {RADIUS_PRESETS_KM.map((km) => {
            const active = committed === km;
            return (
              <button
                key={km}
                type="button"
                aria-pressed={active}
                onClick={() => onChange(km)}
                className={cn(
                  "rounded-md px-2 py-0.5 text-xs font-medium tabular-nums transition-colors",
                  active
                    ? "bg-brand-soft text-brand-soft-fg"
                    : "text-fg-muted hover:bg-surface-muted hover:text-fg",
                )}
              >
                {t("km", { count: km })}
              </button>
            );
          })}
        </div>
      </div>
    </Field>
  );
}
