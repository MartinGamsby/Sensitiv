import { cn } from "@/lib/cn.ts";

/**
 * Half a laurel wreath: a stem with five leaves, curving up and outward.
 *
 * Drawn once and mirrored, so the two sides cannot drift apart. Inline paths
 * rather than an icon-font glyph or an emoji for the reason the locale flags
 * are: a glyph is at the mercy of whatever the platform has installed, and
 * this one is decoration on the most prominent thing in the list.
 */
function LaurelBranch() {
  return (
    <g>
      {/* The stem arcs AROUND the medal, not under it: every point on it sits
          further from the centre (48, 26) than the 18px circle's edge, so the
          leaves flank the number instead of hiding behind it. */}
      <path
        d="M46 48C33 46 23 38 21.5 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <ellipse cx="39.5" cy="47.5" rx="5" ry="2.3" transform="rotate(-15 39.5 47.5)" />
      <ellipse cx="31.8" cy="43.5" rx="5" ry="2.3" transform="rotate(-35 31.8 43.5)" />
      <ellipse cx="25.4" cy="36.5" rx="5" ry="2.3" transform="rotate(-55 25.4 36.5)" />
      <ellipse cx="21.4" cy="28" rx="4.8" ry="2.2" transform="rotate(-75 21.4 28)" />
      <ellipse cx="19.8" cy="19" rx="4.5" ry="2.1" transform="rotate(-88 19.8 19)" />
    </g>
  );
}

function LaurelWreath({ className }: { className?: string }) {
  return (
    <svg
      // 1 unit = 1 rendered pixel, and the centre (48, 26) is the centre of
      // the 36px medal it wraps — which is what keeps the leaves a constant
      // distance outside the circle's edge.
      viewBox="0 0 96 52"
      aria-hidden="true"
      fill="currentColor"
      className={className}
    >
      <LaurelBranch />
      {/* The same branch, flipped about the vertical centre line. Drawn once
          and mirrored so the two sides cannot drift apart. */}
      <g transform="translate(96,0) scale(-1,1)">
        <LaurelBranch />
      </g>
    </svg>
  );
}

/**
 * Podium colours. Complete literal class strings, never interpolated from the
 * rank — Tailwind's content scan cannot see `bg-${x}-50` and would purge it,
 * the same rule `Badge`'s tones follow.
 *
 * Gold, silver and bronze are read as colour ALONE by nobody: the number is
 * inside the medal, so the ranking survives for a reader who cannot tell
 * amber from orange, and for one using a screen reader (where the DOM order
 * carries it and the medal is `aria-hidden`).
 */
const MEDAL_CLASS: Record<number, string> = {
  1: "border-amber-400/80 bg-amber-50 text-amber-800 dark:border-amber-500/60 dark:bg-amber-950 dark:text-amber-200",
  2: "border-slate-400/80 bg-slate-100 text-slate-700 dark:border-slate-500/60 dark:bg-slate-800 dark:text-slate-100",
  3: "border-orange-500/70 bg-orange-50 text-orange-800 dark:border-orange-600/60 dark:bg-orange-950 dark:text-orange-200",
};

const LAUREL_CLASS: Record<number, string> = {
  1: "text-amber-500/80 dark:text-amber-500/70",
  2: "text-slate-400/80 dark:text-slate-400/60",
  3: "text-orange-500/70 dark:text-orange-600/70",
};

export interface RankMedalProps {
  /** 1-based position in the ranked list. */
  rank: number;
  className?: string;
}

/**
 * A place's rank, as a medal straddling the top edge of its card.
 *
 * On the edge rather than inside because rank is a property of the card's
 * position in the list, not another field of the place — and because half of
 * it sitting in the gutter makes it the first thing the eye lands on running
 * down a column, which is the point: rank should register before the match
 * percentage does.
 *
 * Top three get a laurel and a metal. Below that it is a plain chip, which is
 * the honest treatment: the gap between 4th and 5th is usually a rounding
 * error in a heuristic score, and dressing it up would imply a precision the
 * ranking does not have.
 *
 * `aria-hidden` throughout. The order is already carried by the DOM, and
 * announcing a bare number before every place name is noise.
 */
export function RankMedal({ rank, className }: RankMedalProps) {
  const medal = MEDAL_CLASS[rank];

  return (
    <span
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute left-1/2 top-0 z-10 -translate-x-1/2 -translate-y-1/2",
        className,
      )}
    >
      <span className="relative flex h-9 w-9 items-center justify-center">
        {medal ? (
          <LaurelWreath
            className={cn(
              "absolute left-1/2 top-1/2 h-[3.25rem] w-24 -translate-x-1/2 -translate-y-1/2",
              LAUREL_CLASS[rank],
            )}
          />
        ) : null}
        <span
          data-testid="rank-medal"
          data-rank={rank}
          className={cn(
            "relative inline-flex items-center justify-center rounded-full border font-bold tabular-nums shadow-card",
            medal
              ? cn("h-9 w-9 text-base", medal)
              : "h-8 w-8 border-border-strong bg-surface text-sm text-fg-muted",
          )}
        >
          {rank}
        </span>
      </span>
    </span>
  );
}
