import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn.ts";

export interface EmptyStateProps extends HTMLAttributes<HTMLParagraphElement> {
  children: ReactNode;
  /** Trailing call to action, e.g. a "start your first search" link. */
  action?: ReactNode;
}

/**
 * The italic muted "nothing here" note (`dossier.empty`, `history.empty`,
 * `run.log.empty`, `dossier.replayNone`). Renders a `<p>` carrying `italic` —
 * `dossier.test.tsx` asserts on `p.italic` for the no-replay case, so this
 * shape is a contract, not a styling detail. No font-size default: callers
 * that need a specific size (most do) pass it through `className`, same as
 * before this component existed.
 */
export function EmptyState({ children, action, className, ...rest }: EmptyStateProps) {
  return (
    <p className={cn("italic text-fg-muted", className)} {...rest}>
      {children}
      {action}
    </p>
  );
}
