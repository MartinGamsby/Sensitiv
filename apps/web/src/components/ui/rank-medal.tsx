import { cn } from "@/lib/cn.ts";

// ---------------------------------------------------------------------------
// The wreath
//
// Everything below is derived from three numbers so the two sides, the stem
// and every leaf stay on the same circle. The first attempt hand-placed
// ellipses along a hand-drawn curve and looked like beads on a string: round
// blobs sitting ON the stem rather than pointed leaves growing OUT of it.
// ---------------------------------------------------------------------------

/** Centre of the medal the wreath wraps, in viewBox units. */
const CX = 48;
const CY = 26;
/** The stem's radius. The medal's own circle is 18, so the stem clears it by
 *  5 and the leaves grow outward from there. */
const STEM_R = 23;

/**
 * One leaf: a pointed almond with its base at the origin, growing along +x.
 *
 * Two mirrored cubics meeting at a point on each end. The points are what
 * make it read as a leaf — an ellipse is blunt at both ends and reads as a
 * bead, which is exactly how the first version failed.
 */
function leafPath(len: number, half: number): string {
  return (
    `M0 0C${len * 0.3} ${-half} ${len * 0.68} ${-half} ${len} 0` +
    `C${len * 0.68} ${half} ${len * 0.3} ${half} 0 0Z`
  );
}

/**
 * Where each leaf attaches, as an angle on the stem circle (degrees, 90 =
 * bottom, increasing anticlockwise up the left side), and how big it is.
 *
 * Longest in the middle of the branch and tapering to both ends, which is
 * how a real laurel spray grows and what keeps the silhouette from reading
 * as a caterpillar.
 */
const LEAVES = [
  { at: 105, len: 9.5, half: 2.4 },
  { at: 122, len: 11, half: 2.8 },
  { at: 139, len: 11.5, half: 2.9 },
  { at: 156, len: 11, half: 2.8 },
  { at: 173, len: 10, half: 2.5 },
  { at: 190, len: 8.5, half: 2.2 },
];

/**
 * How far a leaf tilts off the stem's own direction, toward "outward".
 *
 * The stem's tangent at angle `a` points along `a + 90°`; pure radial is
 * `a`. Splitting the difference at +60° gives leaves that sweep forward up
 * the branch while still fanning away from the medal — flat along the
 * tangent they overlap each other, and pure radial they look like spokes.
 */
const LEAF_TILT = 60;

/**
 * The stem, as a single cubic approximating the arc from the bottom (90°)
 * round to 200°.
 *
 * Control points are the standard circular-arc approximation,
 * `k = 4/3 · tan(Δθ/4) · r`, so the curve stays within a fraction of a pixel
 * of `STEM_R` the whole way. Hand-guessed controls are what made the first
 * version's leaves drift over the medal.
 */
const STEM_D = "M48 49C32 49 20.9 33.1 26.4 18.1";

function LaurelBranch() {
  return (
    <g>
      <path
        d={STEM_D}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      {LEAVES.map(({ at, len, half }) => {
        const rad = (at * Math.PI) / 180;
        return (
          <path
            key={at}
            d={leafPath(len, half)}
            transform={`translate(${(CX + STEM_R * Math.cos(rad)).toFixed(2)} ${(
              CY +
              STEM_R * Math.sin(rad)
            ).toFixed(2)}) rotate(${at + LEAF_TILT})`}
          />
        );
      })}
    </g>
  );
}

function LaurelWreath({ className }: { className?: string }) {
  return (
    <svg
      // 1 unit = 1 rendered pixel, and (48, 26) — the box's own centre — is
      // the centre of the 36px medal this wraps. That is what lets the CSS
      // centre the two on each other and have the geometry line up.
      viewBox="0 0 96 52"
      aria-hidden="true"
      fill="currentColor"
      className={className}
    >
      <LaurelBranch />
      {/* The same branch, flipped about the vertical centre line: drawn once
          so the two sides cannot drift apart. */}
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
  1: "text-amber-500/90 dark:text-amber-500/80",
  2: "text-slate-400/90 dark:text-slate-400/70",
  3: "text-orange-500/80 dark:text-orange-600/80",
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
        // Half out of the card, plus 3px: sitting dead-centre on the edge
        // left it looking like it had slipped down into the card. The grid's
        // row gap is NOT widened to match — the 3px comes out of the
        // clearance above, not out of the space between cards.
        "pointer-events-none absolute left-1/2 top-0 z-10 -translate-x-1/2 -translate-y-[calc(50%+3px)]",
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
