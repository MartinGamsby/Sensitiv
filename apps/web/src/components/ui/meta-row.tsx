import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn.ts";

export interface MetaRowProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  label?: ReactNode;
  value: ReactNode;
  title?: string;
}

/**
 * A label/value line for secondary metadata: the history card's date and
 * top-result line, a replay row's source/findings/availability. `label`,
 * when given, is the muted leading caption; `value` is everything after it.
 * `title` becomes a native tooltip on the whole row (e.g. a full timestamp).
 */
export function MetaRow({ label, value, title, className, ...rest }: MetaRowProps) {
  return (
    <div
      className={cn("flex flex-wrap items-center gap-1.5 text-xs text-fg-muted", className)}
      title={title}
      {...rest}
    >
      {label ? (
        <span className="font-medium text-neutral-600 dark:text-neutral-400">{label}</span>
      ) : null}
      <span>{value}</span>
    </div>
  );
}
