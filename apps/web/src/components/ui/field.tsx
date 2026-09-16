import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { cn } from "@/lib/cn.ts";

/** Shared control skin: same height, radius, border and focus behaviour for
 *  every input, textarea and select in the app. */
const CONTROL =
  "w-full rounded-lg border border-border-strong bg-surface px-3 text-sm text-fg " +
  "placeholder:text-fg-subtle transition-colors hover:border-brand/60 " +
  "focus:border-brand focus:outline-none focus-visible:outline-none " +
  "disabled:cursor-not-allowed disabled:bg-surface-muted disabled:opacity-70";

export interface FieldProps {
  /** `htmlFor` target; omit for a `fieldset`-style group with no single control. */
  htmlFor?: string;
  label: ReactNode;
  /** One quiet line under the label explaining what this is for. */
  hint?: ReactNode;
  /** Right-aligned label adornment, e.g. an "Optional" tag. */
  adornment?: ReactNode;
  error?: ReactNode;
  className?: string;
  children: ReactNode;
}

/** Label + optional hint + control + optional error, stacked consistently. */
export function Field({
  htmlFor,
  label,
  hint,
  adornment,
  error,
  className,
  children,
}: FieldProps) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <label
          htmlFor={htmlFor}
          className="text-sm font-medium leading-none text-fg"
        >
          {label}
        </label>
        {adornment ? (
          <span className="text-xs text-fg-subtle">{adornment}</span>
        ) : null}
      </div>
      {hint ? <p className="text-xs leading-snug text-fg-muted">{hint}</p> : null}
      {children}
      {error ? (
        <p role="alert" className="text-xs font-medium text-danger-600 dark:text-danger-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function Input({
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(CONTROL, "h-10", className)} {...rest} />;
}

export function Textarea({
  className,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(CONTROL, "resize-y py-2.5 leading-relaxed", className)} {...rest} />;
}

export function Select({
  className,
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(CONTROL, "h-10 cursor-pointer pr-8", className)} {...rest}>
      {children}
    </select>
  );
}
