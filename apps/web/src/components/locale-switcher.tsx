"use client";

import { useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation.ts";
import { routing } from "@/i18n/routing.ts";
import { LocaleFlag } from "./ui/flag.tsx";
import { cn } from "@/lib/cn.ts";

/**
 * Locale switch that PERSISTS ON THE USER: it PATCHes `/api/settings` with the
 * new `uiLocale`, then navigates to the same path under the new locale.
 *
 * Rendered as a segmented control rather than a `<select>` — with two locales,
 * a dropdown costs two clicks to do what one button does, and the current
 * locale is readable without opening anything.
 */
export function LocaleSwitcher() {
  const t = useTranslations("localeSwitcher");
  const activeLocale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function onSelect(next: string) {
    if (next === activeLocale) return;
    startTransition(async () => {
      try {
        await fetch("/api/settings", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ uiLocale: next }),
        });
      } catch {
        // Persisting the preference is best-effort; still switch the UI.
      }
      router.replace(pathname, { locale: next });
    });
  }

  return (
    <div
      role="group"
      aria-label={t("label")}
      className="flex items-center gap-0.5 rounded-lg bg-surface-muted p-0.5"
    >
      {routing.locales.map((locale) => {
        const active = locale === activeLocale;
        // `localeSwitcher.en` / `.fr` are the languages' OWN names in both
        // message files — "Français" reads the same whichever locale is
        // currently on — so the tooltip and the screen-reader name say what a
        // speaker of that language would call it, not a translation of it.
        const nativeName = t(locale as "en" | "fr");
        return (
          <button
            key={locale}
            type="button"
            aria-pressed={active}
            disabled={isPending}
            onClick={() => onSelect(locale)}
            title={nativeName}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold uppercase tracking-wide transition-colors disabled:opacity-60",
              active
                ? "bg-surface text-fg shadow-card"
                : "text-fg-muted hover:text-fg",
            )}
          >
            <LocaleFlag
              locale={locale}
              className={active ? "" : "opacity-70 grayscale-[0.35]"}
            />
            {locale}
            <span className="sr-only"> — {nativeName}</span>
          </button>
        );
      })}
    </div>
  );
}
