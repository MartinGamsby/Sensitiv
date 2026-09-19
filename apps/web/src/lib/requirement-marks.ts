// One pill per requirement, for the shortlist card.
//
// A card used to show a single percentage, which answers "how good is this
// place overall" and NOT the question someone actually opens this app with:
// "is this one safe for me?" On a celiac + "Mexican restaurant" run those come
// apart — a confirmed Mexican restaurant with nothing said about gluten scores
// respectably, and a reader scanning the list has no way to see which of the
// two halves earned it the number. These marks put each requirement's own
// contribution on the card so the list can be read down one column.
//
// Derived from the breakdown the WORKER stored, for the same reason
// `ScoreBreakdown` is: the lines that ranked this place are the lines a reader
// should see, even after the rubric moves on. Nothing here re-scores anything.
import { isValidRequirementId } from "@sensitiv/shared/catalog/index";
import type { ScoreLine } from "@sensitiv/shared";

export interface RequirementMark {
  requirementId: string;
  /** Every weighted line for this requirement, summed. */
  delta: number;
  /** The requirement's multiplier, for ordering and for the tooltip. */
  weight: number;
  /**
   * False when the ONLY rule that fired was `unverified` — no source settled
   * this either way. Distinct from `delta === 0` on purpose: a requirement can
   * land on zero by being both supported and contradicted, and "nobody said"
   * must never render the same as "the sources cancelled out".
   */
  settled: boolean;
  /** A source supports it AND a source contradicts it. */
  conflicted: boolean;
  /** True for a catalog chip, false for a `custom_<slug>` the planner minted. */
  fromChip: boolean;
}

/** Rules that mean a source said yes. */
const POSITIVE_RULES = new Set(["explicit", "supported", "corroborated"]);

/**
 * One mark per requirement in the breakdown, heaviest first.
 *
 * `proximity` is excluded: it carries no `requirementId` because it is a fact
 * about the place rather than about anything the user asked for, and it already
 * has its own line in the detail view.
 *
 * Ordering puts the CHIPS the user ticked first, then the heaviest, then the
 * strongest. Chips lead on their own key rather than by weight alone so the
 * column reads consistently down the whole list and across runs: a reader
 * scanning for celiac should find it in the same position on every card, and it
 * must not slide behind the cuisine on an older dossier whose stored weights
 * predate the chips being worth double. Ties fall through to the id, so nothing
 * swaps places between renders.
 */
export function requirementMarks(
  breakdown: readonly ScoreLine[],
): RequirementMark[] {
  const byId = new Map<string, RequirementMark>();

  for (const line of breakdown) {
    if (line.rule === "proximity" || line.requirementId === "") continue;
    const mark = byId.get(line.requirementId) ?? {
      requirementId: line.requirementId,
      delta: 0,
      weight: line.weight,
      settled: false,
      conflicted: false,
      fromChip: isValidRequirementId(line.requirementId),
    };
    mark.delta += line.delta;
    // Keep the largest weight seen. In practice every line for one requirement
    // carries the same one; taking the max means a malformed row can only ever
    // sort a requirement too high, never silently demote a safety one.
    mark.weight = Math.max(mark.weight, line.weight);
    if (line.rule !== "unverified") mark.settled = true;
    byId.set(line.requirementId, mark);
  }

  for (const line of breakdown) {
    const mark = byId.get(line.requirementId);
    if (!mark) continue;
    if (line.rule !== "contradicted") continue;
    mark.conflicted = breakdown.some(
      (other) =>
        other.requirementId === line.requirementId && POSITIVE_RULES.has(other.rule),
    );
  }

  return [...byId.values()].sort(
    (a, b) =>
      Number(b.fromChip) - Number(a.fromChip) ||
      b.weight - a.weight ||
      b.delta - a.delta ||
      a.requirementId.localeCompare(b.requirementId),
  );
}

/** `+9.6` / `-1.5` / `0` — signed, one decimal, whole numbers stay whole. */
export function formatDelta(delta: number): string {
  const rounded = Math.round(delta * 10) / 10;
  return `${rounded > 0 ? "+" : ""}${rounded}`;
}

export type MarkTone = "ok" | "warn" | "danger" | "neutral";

/**
 * How a mark reads at a glance.
 *
 * `warn` outranks everything else: a requirement the sources DISAGREE about is
 * the one fact a reader skimming a shortlist most needs, and it must not be
 * rendered green because the positive evidence happened to be the stronger of
 * the two. Unsettled is `neutral`, never green — "no source settled this" is
 * not a pass.
 */
export function markTone(mark: RequirementMark): MarkTone {
  if (mark.conflicted) return "warn";
  if (!mark.settled) return "neutral";
  if (mark.delta > 0) return "ok";
  if (mark.delta < 0) return "danger";
  return "neutral";
}
