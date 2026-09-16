"use client";

import { useLocale } from "next-intl";
import { disclaimerFor, type UiLocale } from "@sensitiv/shared";
import { InfoIcon } from "./ui/icon.tsx";
import { cn } from "@/lib/cn.ts";

/**
 * The mandatory research-assistance disclaimer. Rendered in the layout footer
 * AND at the top of every dossier. Visible text, never a tooltip and never
 * inside a collapsed section. The exact wording comes from `disclaimerFor` in
 * the shared package — do not re-type it.
 */
export function Disclaimer({ className }: { className?: string }) {
  const locale = useLocale() as UiLocale;
  return (
    <p
      className={cn(
        "flex items-start gap-1.5 text-xs leading-relaxed text-fg-muted",
        className,
      )}
      role="note"
    >
      <InfoIcon className="mt-px h-3.5 w-3.5 shrink-0 text-fg-subtle" />
      {disclaimerFor(locale === "fr" ? "fr" : "en")}
    </p>
  );
}
