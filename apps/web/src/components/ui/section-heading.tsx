import type { ReactNode } from "react";
import { cn } from "@/lib/cn.ts";

export interface SectionHeadingProps {
  /** Heading level. Pages use `h1`, sections `h2`, cards `h3`. */
  as?: "h1" | "h2" | "h3";
  children: ReactNode;
  /** One quiet line under the heading. */
  description?: ReactNode;
  /** Right-aligned controls on the heading row. */
  action?: ReactNode;
  /** Small leading badge, e.g. a step number. */
  eyebrow?: ReactNode;
  className?: string;
}

const LEVEL_CLASS = {
  h1: "text-2xl font-semibold tracking-tight sm:text-3xl",
  h2: "text-lg font-semibold tracking-tight",
  h3: "text-base font-semibold",
} as const;

/** Title row shared by every page and card section. */
export function SectionHeading({
  as: Tag = "h2",
  children,
  description,
  action,
  eyebrow,
  className,
}: SectionHeadingProps) {
  return (
    <div className={cn("flex items-start justify-between gap-4", className)}>
      <div className="min-w-0">
        <div className="flex items-center gap-2.5">
          {eyebrow ? (
            <span
              aria-hidden="true"
              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-semibold text-brand-soft-fg"
            >
              {eyebrow}
            </span>
          ) : null}
          <Tag className={cn(LEVEL_CLASS[Tag], "text-fg")}>{children}</Tag>
        </div>
        {description ? (
          <p className="mt-1.5 text-sm leading-relaxed text-fg-muted">{description}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
