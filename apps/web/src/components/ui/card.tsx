import type { ElementType, HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn.ts";

export type CardTone = "default" | "warn" | "muted" | "brand" | "danger";
export type CardElement = "article" | "li" | "div" | "section" | "aside";
export type CardPadding = "none" | "sm" | "md" | "lg";

/**
 * The app's surface. `default` is the resting card; `muted` is a flat inset
 * (the event log, the disclaimer); `warn` is the amber conflicted/degraded
 * surface; `brand` is the teal tint used for supportive notes.
 */
const TONE_CLASS: Record<CardTone, string> = {
  default: "border-border-subtle bg-surface shadow-card",
  warn: "border-warn-300 bg-warn-50 dark:border-warn-900/70 dark:bg-warn-950/50",
  muted: "border-border-subtle bg-surface-muted",
  brand: "border-brand/25 bg-brand-soft",
  danger: "border-danger-300 bg-danger-50 dark:border-danger-900/70 dark:bg-danger-950/40",
};

const PADDING_CLASS: Record<CardPadding, string> = {
  none: "",
  sm: "p-3",
  md: "p-4",
  lg: "p-5 sm:p-6",
};

export interface CardProps extends HTMLAttributes<HTMLElement> {
  tone?: CardTone;
  as?: CardElement;
  padding?: CardPadding;
  interactive?: boolean;
  children?: ReactNode;
  // Arbitrary `data-*` passthrough (e.g. `data-conflicted`, `data-testid`) —
  // `HTMLAttributes` does not declare these by name.
  [dataAttr: `data-${string}`]: unknown;
}

export function Card({
  tone = "default",
  as = "div",
  padding = "md",
  interactive = false,
  className,
  children,
  ...rest
}: CardProps) {
  const Component = as as ElementType;
  return (
    <Component
      className={cn(
        "rounded-xl border",
        TONE_CLASS[tone],
        PADDING_CLASS[padding],
        interactive &&
          "transition-all hover:-translate-y-px hover:border-brand/40 hover:shadow-raised",
        className,
      )}
      {...rest}
    >
      {children}
    </Component>
  );
}
