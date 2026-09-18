"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { MonitorIcon, MoonIcon, SunIcon } from "./ui/icon.tsx";
import { cn } from "@/lib/cn.ts";

/**
 * `system` is a real third choice, not a default the other two replace: a
 * reader whose laptop flips to dark in the evening asked for that, and a
 * two-state toggle would silently pin them to whatever they last tapped.
 */
export const THEMES = ["system", "light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

/** Read by the inline script in the layout too — keep the two in step. */
export const THEME_STORAGE_KEY = "sensitiv.theme";

export function isTheme(value: unknown): value is Theme {
  return typeof value === "string" && (THEMES as readonly string[]).includes(value);
}

/**
 * Put the choice on `<html>`, exactly as the pre-paint script does.
 *
 * `system` REMOVES the attribute rather than resolving it to a colour here.
 * The `prefers-color-scheme` block in `globals.css` then does the work, which
 * means the page keeps following the OS live — resolving it in JS would
 * freeze whatever the OS happened to be at load.
 */
export function applyTheme(theme: Theme, root: HTMLElement): void {
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
}

function readStoredTheme(): Theme {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(raw) ? raw : "system";
  } catch {
    // Private mode, blocked site data, a locked-down profile: the preference
    // is a convenience and the page renders correctly without it.
    return "system";
  }
}

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
    setTheme(readStoredTheme());
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
