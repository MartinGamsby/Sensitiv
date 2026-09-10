"use client";

import { useTranslations } from "next-intl";
import { DEFAULT_JOB_TIMEOUT_SEC } from "@sensitiv/shared";

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
    <div className="flex flex-col gap-1">
      <label className="text-sm font-medium" htmlFor="timeout-select">
        {t("label")}
      </label>
      <select
        id="timeout-select"
        value={minutes}
        onChange={(e) => onChange(Number(e.target.value) * 60)}
        className="rounded border border-gray-300 bg-transparent px-2 py-1.5 text-sm dark:border-gray-700"
      >
        {TIMEOUT_OPTIONS_MIN.map((m) => (
          <option key={m} value={m}>
            {t("minutes", { count: m })}
          </option>
        ))}
      </select>
      {onSaveAsDefaultChange ? (
        <label className="mt-1 flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400">
          <input
            type="checkbox"
            checked={saveAsDefault}
            onChange={(e) => onSaveAsDefaultChange(e.target.checked)}
          />
          {t("saveDefault")}
        </label>
      ) : null}
    </div>
  );
}
