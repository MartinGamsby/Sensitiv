import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn.ts";

export type ButtonVariant = "primary" | "secondary" | "ghost";
export type ButtonSize = "sm" | "md" | "lg";

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary:
    "bg-brand text-brand-fg shadow-card hover:bg-brand-hover active:translate-y-px",
  secondary:
    "border border-border-strong bg-surface text-fg hover:border-brand hover:text-brand",
  ghost: "text-fg-muted hover:bg-surface-muted hover:text-fg",
};

const SIZE_CLASS: Record<ButtonSize, string> = {
  sm: "h-8 gap-1.5 px-3 text-xs",
  md: "h-10 gap-2 px-4 text-sm",
  lg: "h-12 gap-2 px-6 text-base",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Leading glyph, rendered before `children` and hidden from assistive tech. */
  icon?: ReactNode;
  fullWidth?: boolean;
}

/**
 * The app's one button. `type` defaults to `"button"` on purpose: these live
 * inside `<form>` (example presets, chip toggles, "Use my location") where the
 * HTML default of `submit` would fire a run on every click.
 */
export function Button({
  variant = "secondary",
  size = "md",
  icon,
  fullWidth = false,
  className,
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex select-none items-center justify-center rounded-lg font-medium transition-colors",
        "disabled:pointer-events-none disabled:opacity-50",
        VARIANT_CLASS[variant],
        SIZE_CLASS[size],
        fullWidth && "w-full",
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
    </button>
  );
}
