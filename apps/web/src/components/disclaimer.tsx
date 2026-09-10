"use client";

import { useLocale } from "next-intl";
import { disclaimerFor, type UiLocale } from "@sensitiv/shared";

/**
 * The mandatory research-assistance disclaimer. Rendered in the layout footer
 * AND at the top of every dossier. Visible text, never a tooltip. The exact
 * wording comes from `disclaimerFor` in the shared package — do not re-type it.
 */
export function Disclaimer({ className }: { className?: string }) {
  const locale = useLocale() as UiLocale;
  return (
    <p
      className={
        "text-xs leading-relaxed text-gray-500 dark:text-gray-400 " +
        (className ?? "")
      }
      role="note"
    >
      {disclaimerFor(locale === "fr" ? "fr" : "en")}
    </p>
  );
}
