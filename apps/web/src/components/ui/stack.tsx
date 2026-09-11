import type { ElementType, HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn.ts";

export type StackGap = 1 | 2 | 3 | 4 | 5 | 6;
export type StackDirection = "col" | "row";

const GAP_CLASS: Record<StackGap, string> = {
  1: "gap-1",
  2: "gap-2",
  3: "gap-3",
  4: "gap-4",
  5: "gap-5",
  6: "gap-6",
};

export interface StackProps extends HTMLAttributes<HTMLElement> {
  gap?: StackGap;
  direction?: StackDirection;
  as?: ElementType;
  children?: ReactNode;
}

/** The `flex flex-col gap-N` wrapper repeated throughout the app's markup. */
export function Stack({
  gap = 4,
  direction = "col",
  as = "div",
  className,
  children,
  ...rest
}: StackProps) {
  const Component = as;
  return (
    <Component
      className={cn("flex", direction === "row" ? "flex-row" : "flex-col", GAP_CLASS[gap], className)}
      {...rest}
    >
      {children}
    </Component>
  );
}
