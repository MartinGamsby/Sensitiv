"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { MonitorIcon, MoonIcon, SunIcon } from "./ui/icon.tsx";
import {
  THEMES,
  THEME_STORAGE_KEY,
  applyTheme,
  readStoredTheme,
  type Theme,
} from "@/lib/theme.ts";
import { cn } from "@/lib/cn.ts";

const ICONS: Record<Theme, typeof SunIcon> = {
  system: MonitorIcon,
  light: SunIcon,
  dark: MoonIcon,
};

/**
 * Theme switch, built as the same segmented control as `LocaleSwitcher` so
 * the two read as one pair of controls rather than two conventions.
 *
 * The preference lives in `localStorage`, not in `users` — unlike the UI
 * locale it is a property of the SCREEN you are reading on, and syncing it to
 * the account would mean a desktop choice following you onto a phone. That
 * also keeps it out of the round trip: the pre-paint script in the layout can
 * read it synchronously, which is what stops a dark reader seeing a white
 * flash on every navigation.
 */
export function ThemeSwitcher() {
  const t = useTranslations("themeSwitcher");
  // Server-render `system` unconditionally: the real value only exists in the
  // browser, and rendering a guess would make the markup mismatch. The effect
  // below corrects it on mount, before the user can press anything.
  const [theme, setTheme] = useState<Theme>("system");

  useEffect(() => {
    const stored = readStoredTheme();
    setTheme(stored);
    // APPLY, not just read. The pre-paint script only runs on a full document
    // load, and switching locale re-mounts the root layout — so on any
    // navigation that leaves `<html>` without the attribute, this is what puts
    // it back. Reading alone would light up the right segment over a page
    // painted in the wrong theme, which is how this was broken.
    applyTheme(stored, document.documentElement);
  }, []);

  function onSelect(next: Theme) {
    setTheme(next);
    applyTheme(next, document.documentElement);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Best-effort: the theme still applies for this page load.
    }
  }

  return (
    <div
      role="group"
      aria-label={t("label")}
      className="flex items-center gap-0.5 rounded-lg bg-surface-muted p-0.5"
    >
      {THEMES.map((option) => {
        const active = option === theme;
        const Glyph = ICONS[option];
        const label = t(option);
        return (
          <button
            key={option}
            type="button"
            aria-pressed={active}
            onClick={() => onSelect(option)}
            title={label}
            className={cn(
              "rounded-md p-1.5 transition-colors",
              active
                ? "bg-surface text-fg shadow-card"
                : "text-fg-muted hover:text-fg",
            )}
          >
            <Glyph className="h-3.5 w-3.5" />
            <span className="sr-only">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
