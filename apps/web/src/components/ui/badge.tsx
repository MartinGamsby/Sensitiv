import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn.ts";

export type BadgeTone = "neutral" | "ok" | "warn" | "danger" | "info" | "brand";
export type BadgeSize = "sm" | "md";

/** Exported so `MatchPill` — which needs this shape but computes its own
 *  colour from a hue — cannot drift away from the badges beside it. */
export const BADGE_SIZE_CLASS: Record<BadgeSize, string> = {
  sm: "gap-1 px-2 py-0.5 text-[11px] font-medium",
  md: "gap-1.5 px-2.5 py-1 text-xs font-semibold",
};

/**
 * The status/consensus/provenance pill. Every value below is a complete
 * literal class string — never build one by interpolating the tone
 * (bg-${tone}-100), or Tailwind's content scan can't see it and purges it
 * from the build.
 */
const TONE_CLASS: Record<BadgeTone, string> = {
  neutral: "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200",
  ok: "bg-ok-100 text-ok-800 dark:bg-ok-900/60 dark:text-ok-200",
  warn: "bg-warn-100 text-warn-900 dark:bg-warn-900/60 dark:text-warn-100",
  danger: "bg-danger-100 text-danger-800 dark:bg-danger-900/60 dark:text-danger-200",
  info: "bg-info-100 text-info-800 dark:bg-info-900/60 dark:text-info-200",
  brand: "bg-brand-soft text-brand-soft-fg",
};

// The place-card score chip is the one badge that inverts to a solid chip
// instead of a tint. Kept as this one literal combination (tone "neutral" +
// size "md") rather than a generic "solid" prop nothing else needs yet.
const NEUTRAL_MD_CLASS =
  "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone: BadgeTone;
  size?: BadgeSize;
  /** Leading glyph. Decorative — the badge's own text carries the meaning. */
  icon?: ReactNode;
  children?: ReactNode;
  [dataAttr: `data-${string}`]: unknown;
}

export function Badge({
  tone,
  size = "sm",
  icon,
  className,
  children,
  ...rest
}: BadgeProps) {
  const toneClass =
    tone === "neutral" && size === "md" ? NEUTRAL_MD_CLASS : TONE_CLASS[tone];
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full",
        BADGE_SIZE_CLASS[size],
        toneClass,
        className,
      )}
      {...rest}
    >
      {icon ? (
        <span aria-hidden="true" className="shrink-0">
          {icon}
        </span>
      ) : null}
      {children}
    </span>
  );
}
