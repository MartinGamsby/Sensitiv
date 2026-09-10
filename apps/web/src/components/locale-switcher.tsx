"use client";

import { useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation.ts";
import { routing } from "@/i18n/routing.ts";

/**
 * Locale switch that PERSISTS ON THE USER: it PATCHes `/api/settings` with the
 * new `uiLocale`, then navigates to the same path under the new locale.
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
    <label className="flex items-center gap-1 text-sm">
      <span className="sr-only">{t("label")}</span>
      <select
        aria-label={t("label")}
        value={activeLocale}
        disabled={isPending}
        onChange={(e) => onSelect(e.target.value)}
        className="rounded border border-gray-300 bg-transparent px-1.5 py-1 dark:border-gray-700"
      >
        {routing.locales.map((locale) => (
          <option key={locale} value={locale}>
            {t(locale as "en" | "fr")}
          </option>
        ))}
      </select>
    </label>
  );
}
