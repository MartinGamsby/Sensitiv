"use client";

import { useTranslations } from "next-intl";
import { ListIcon, MapIcon } from "./ui/icon.tsx";
import { DOSSIER_VIEWS, type DossierView } from "@/lib/dossier-view.ts";
import { cn } from "@/lib/cn.ts";

const ICONS: Record<DossierView, typeof MapIcon> = {
  list: ListIcon,
  map: MapIcon,
};

/**
 * List / map, as the same segmented control the theme and locale switches
 * use — three of these on one page would look like three different apps
 * otherwise.
 *
 * A button rather than a `Link` per view even though the state lives in the
 * URL: switching views is a `replace`, not a `push`. Back should leave the
 * dossier, not walk the reader through every time they glanced at the map.
 */
export function DossierViewSwitch({
  value,
  onChange,
}: {
  value: DossierView;
  onChange: (next: DossierView) => void;
}) {
  const t = useTranslations("dossier.view");

  return (
    <div
      role="group"
      aria-label={t("label")}
      className="flex items-center gap-0.5 rounded-lg bg-surface-muted p-0.5"
    >
      {DOSSIER_VIEWS.map((view) => {
        const active = view === value;
        const Glyph = ICONS[view];
        return (
          <button
            key={view}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(view)}
            title={t(view)}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
              active
                ? "bg-surface text-fg shadow-card"
                : "text-fg-muted hover:text-fg",
            )}
          >
            <Glyph className="h-3.5 w-3.5" />
            {t(view)}
          </button>
        );
      })}
    </div>
  );
}
