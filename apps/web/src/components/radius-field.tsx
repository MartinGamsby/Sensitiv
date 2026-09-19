"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  DEFAULT_RADIUS_KM,
  MAX_RADIUS_KM,
  MIN_RADIUS_KM,
} from "@sensitiv/shared";
import { Input } from "./ui/index.ts";

/** Round to the step the controls offer, so 2.7000000000000002 never reaches
 *  the job row. */
function quantise(km: number): number {
  return Math.round(km * 2) / 2;
}

export function clampRadius(km: number): number {
  return quantise(Math.min(MAX_RADIUS_KM, Math.max(MIN_RADIUS_KM, km)));
}

/**
 * The slider's travel, as an integer 0..`SLIDER_STEPS`, mapped to km on a
 * SQUARE curve rather than a straight line.
 *
 * Linear over 0.5–100 km would spend nine tenths of the track on distances
 * nobody searches: the useful range for "somewhere I can actually get to" is
 * about 1–10 km, which a linear slider squeezes into the first centimetre.
 * Squaring gives that range roughly the first third of the travel and still
 * reaches 100 at the end.
 */
const SLIDER_STEPS = 500;

export function sliderToKm(pos: number): number {
  const t = Math.min(1, Math.max(0, pos / SLIDER_STEPS));
  return clampRadius(MIN_RADIUS_KM + (MAX_RADIUS_KM - MIN_RADIUS_KM) * t * t);
}

export function kmToSlider(km: number): number {
  const t = Math.sqrt(
    Math.min(
      1,
      Math.max(0, (km - MIN_RADIUS_KM) / (MAX_RADIUS_KM - MIN_RADIUS_KM)),
    ),
  );
  return Math.round(t * SLIDER_STEPS);
}

export interface RadiusFieldProps {
  /** `undefined` means the draft has not set one; the default is shown. */
  value: number | undefined;
  onChange: (km: number) => void;
  className?: string;
}

/**
 * The search radius, as one horizontal line: a label, a slider, a number.
 *
 * It was a `<select>` over four options, then a boxed number input with
 * preset chips beneath it. Both read as a block competing with the fields
 * around them, when the thing being set is a single scalar — a line is the
 * honest shape for it. The slider is the coarse gesture and the number box
 * the exact one; between them the presets stopped earning their space.
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

  // Follow the draft when something else changes it — the slider, or the form
  // being reset. Skipped while the text already means this number, so it
  // cannot overwrite what the reader is mid-way through typing.
  useEffect(() => {
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
    <div className={className}>
      <div className="flex items-center gap-3">
        <label
          htmlFor="location-radius"
          className="whitespace-nowrap text-sm font-medium text-fg"
        >
          {t("label")}
        </label>
        <input
          type="range"
          min={0}
          max={SLIDER_STEPS}
          step={1}
          value={kmToSlider(committed)}
          onChange={(e) => onChange(sliderToKm(Number(e.target.value)))}
          aria-label={t("label")}
          // `accent-color` themes the track and the thumb in one property,
          // which is the whole reason this is a native range and not a div.
          className="h-1.5 min-w-0 flex-1 cursor-pointer accent-brand"
        />
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
          className="w-[4.75rem] shrink-0 text-right tabular-nums"
        />
        <span className="shrink-0 text-sm text-fg-muted">{t("unit")}</span>
      </div>
      <p className="mt-1.5 text-xs text-fg-subtle">{t("hint")}</p>
    </div>
  );
}
