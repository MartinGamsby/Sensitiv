"use client";

import { useTranslations } from "next-intl";
import { DEFAULT_JOB_TIMEOUT_SEC } from "@sensitiv/shared";
import { Field, Select } from "./ui/index.ts";

export const TIMEOUT_OPTIONS_MIN = [2, 5, 8, 15, 25] as const;

export interface TimeoutComboboxProps {
  /** Timeout in SECONDS. Defaults to 480 (8 minutes). */
  value?: number;
  onChange: (seconds: number) => void;
  saveAsDefault?: boolean;
  onSaveAsDefaultChange?: (checked: boolean) => void;
}

export function TimeoutCombobox({
  value = DEFAULT_JOB_TIMEOUT_SEC,
  onChange,
  saveAsDefault = false,
  onSaveAsDefaultChange,
}: TimeoutComboboxProps) {
  const t = useTranslations("form.timeout");
  const minutes = Math.round(value / 60);

  return (
    <Field htmlFor="timeout-select" label={t("label")} hint={t("hint")}>
      <Select
        id="timeout-select"
        value={minutes}
        onChange={(e) => onChange(Number(e.target.value) * 60)}
      >
        {TIMEOUT_OPTIONS_MIN.map((m) => (
          <option key={m} value={m}>
            {t("minutes", { count: m })}
          </option>
        ))}
      </Select>
      {onSaveAsDefaultChange ? (
        <label className="mt-0.5 flex cursor-pointer items-center gap-2 text-xs text-fg-muted">
          <input
            type="checkbox"
            className="h-3.5 w-3.5 rounded border-border-strong accent-[rgb(var(--brand))]"
            checked={saveAsDefault}
            onChange={(e) => onSaveAsDefaultChange(e.target.checked)}
          />
          {t("saveDefault")}
        </label>
      ) : null}
    </Field>
  );
}
