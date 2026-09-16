"use client";

import { useId, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn.ts";
import { ChevronIcon } from "./icon.tsx";

export interface DisclosureProps {
  summary: ReactNode;
  /** Right-aligned hint on the trigger row, e.g. a count or a status word. */
  meta?: ReactNode;
  defaultOpen?: boolean;
  /** Controlled mode — pass both to drive it from outside. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
  triggerClassName?: string;
  contentClassName?: string;
  children: ReactNode;
}

/**
 * A button + region pair, not `<details>`: the content stays mounted when
 * collapsed (hidden with `hidden`), because several tests and the "no replay
 * available" note assert on markup that must exist whether or not the section
 * is open — and because a collapsed region should still be findable by the
 * browser's in-page search.
 */
export function Disclosure({
  summary,
  meta,
  defaultOpen = false,
  open: controlledOpen,
  onOpenChange,
  className,
  triggerClassName,
  contentClassName,
  children,
}: DisclosureProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const open = controlledOpen ?? uncontrolledOpen;
  const id = useId();

  function toggle() {
    const next = !open;
    if (controlledOpen === undefined) setUncontrolledOpen(next);
    onOpenChange?.(next);
  }

  return (
    <div className={className}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={toggle}
        className={cn(
          "flex w-full items-center gap-2 rounded-lg py-2 text-left text-sm font-medium text-fg-muted transition-colors hover:text-fg",
          triggerClassName,
        )}
      >
        <ChevronIcon
          className={cn("h-4 w-4 shrink-0 transition-transform", open && "rotate-90")}
        />
        <span className="flex-1">{summary}</span>
        {meta ? <span className="text-xs font-normal text-fg-subtle">{meta}</span> : null}
      </button>
      <div id={id} hidden={!open} className={cn("pt-1", contentClassName)}>
        {children}
      </div>
    </div>
  );
}
