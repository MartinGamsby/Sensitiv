import { BADGE_SIZE_CLASS } from "./badge.tsx";
import { cn } from "@/lib/cn.ts";

/**
 * Percentage -> hue, red at 0 through orange and yellow to green at 100.
 *
 * Linear across the 0–120 arc of the HSL wheel, which lands 25% on orange and
 * 50% on yellow — the ramp a reader already expects from a fuel gauge. Clamped
 * because `scorePercent` is derived from a signed score against a run-wide
 * ceiling, and a place that contradicts everything it was asked about can come
 * out below zero.
 */
export function matchHue(percent: number): number {
  return Math.round(Math.min(100, Math.max(0, percent)) * 1.2);
}

export interface MatchPillProps {
  percent: number;
  children: React.ReactNode;
  className?: string;
}

/**
 * The match percentage, tinted by how good the match is.
 *
 * Not a `Badge` tone. Tones are deliberately whole literal class strings —
 * Tailwind's content scan cannot see `bg-${tone}-100` and would purge it —
 * and a per-place hue is by definition not a literal. So the geometry is
 * shared with `Badge` (one source for the pill shape) and only the colour is
 * computed: an inline `--match-h` custom property, with `.match-pill` in
 * `globals.css` turning it into a background and a foreground per theme.
 *
 * Tinted rather than the solid chip the neutral badge uses, because a solid
 * chip needs light text and mid-ramp yellow cannot carry it — the pairs in
 * `globals.css` clear 5:1 at their worst point across the whole ramp.
 *
 * The colour is never the only cue: the number it is tinting is right there,
 * which is what keeps this readable for a reader who cannot separate red from
 * green.
 */
export function MatchPill({ percent, children, className }: MatchPillProps) {
  return (
    <span
      data-testid="match-pill"
      style={{ ["--match-h" as string]: matchHue(percent) }}
      className={cn(
        "match-pill inline-flex items-center whitespace-nowrap rounded-full",
        BADGE_SIZE_CLASS.md,
        className,
      )}
    >
      {children}
    </span>
  );
}
