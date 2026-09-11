import type { ElementType, HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn.ts";

export type CardTone = "default" | "warn" | "muted";
export type CardElement = "article" | "li" | "div";

/**
 * The bordered/rounded container duplicated across `dossier-place-card.tsx`,
 * `job-history.tsx` and `dossier.tsx` before this layer existed. `tone="warn"`
 * is the amber conflicted-place card; `tone="muted"` is the flat info-box
 * look (the disclaimer wrapper). `interactive` adds the hover border used by
 * a clickable card (the history row).
 */
const TONE_CLASS: Record<CardTone, string> = {
  default: "border-border-subtle dark:border-neutral-800",
  warn: "border-warn-400 bg-warn-50 dark:bg-warn-950/40",
  muted: "border-border-subtle bg-surface-muted dark:border-neutral-800 dark:bg-neutral-900",
};

export interface CardProps extends HTMLAttributes<HTMLElement> {
  tone?: CardTone;
  as?: CardElement;
  interactive?: boolean;
  children?: ReactNode;
  // Arbitrary `data-*` passthrough (e.g. `data-conflicted`, `data-testid`) —
  // `HTMLAttributes` does not declare these by name.
  [dataAttr: `data-${string}`]: unknown;
}

export function Card({
  tone = "default",
  as = "div",
  interactive = false,
  className,
  children,
  ...rest
}: CardProps) {
  const Component = as as ElementType;
  return (
    <Component
      className={cn(
        "rounded-lg border p-4",
        TONE_CLASS[tone],
        interactive && "hover:border-neutral-400",
        className,
      )}
      {...rest}
    >
      {children}
    </Component>
  );
}
