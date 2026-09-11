import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Conditional class names with later Tailwind utilities winning over earlier
 *  ones — so a component's `className` prop can override its own defaults. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
