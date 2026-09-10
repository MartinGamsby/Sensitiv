// Explainable, catalog-driven scoring. Per requirement, per place:
//   +2  a source explicitly marks the requirement (a confident supporting claim)
//   +1  multiple reviews support it
//   -2  reviews contradict it
//   -1  a single source is the only mention (and nothing stronger fired)
// Sum per place; keep the per-rule breakdown (the UI shows it). A place with
// BOTH supporting and contradicting evidence for one requirement is `conflicted`
// (rendered amber) and is never filtered out.
import type { Evidence } from "@sensitiv/shared";

export type ScoreRule = "+2" | "+1" | "-2" | "-1";

export interface ScoreLine {
  requirementId: string;
  rule: ScoreRule;
  delta: number;
  reason: string;
}

export interface PlaceScore {
  score: number;
  conflicted: boolean;
  breakdown: ScoreLine[];
}

/** A supporting claim at/above this confidence counts as an explicit mark. */
export const EXPLICIT_MARK_CONFIDENCE = 0.8;

export function scorePlace(evidence: readonly Evidence[]): PlaceScore {
  const breakdown: ScoreLine[] = [];
  let conflicted = false;

  const byRequirement = new Map<string, Evidence[]>();
  for (const item of evidence) {
    const list = byRequirement.get(item.requirementId) ?? [];
    list.push(item);
    byRequirement.set(item.requirementId, list);
  }

  for (const [requirementId, list] of byRequirement) {
    const supports = list.filter((e) => e.polarity === "supports");
    const contradicts = list.filter((e) => e.polarity === "contradicts");
    const sources = new Set(list.map((e) => e.source));
    const explicit = supports.some(
      (e) => e.confidence >= EXPLICIT_MARK_CONFIDENCE,
    );

    if (explicit) {
      breakdown.push({
        requirementId,
        rule: "+2",
        delta: 2,
        reason: "a source explicitly marks this requirement",
      });
    }
    if (supports.length >= 2) {
      breakdown.push({
        requirementId,
        rule: "+1",
        delta: 1,
        reason: "multiple reviews support this requirement",
      });
    }
    if (contradicts.length >= 1) {
      breakdown.push({
        requirementId,
        rule: "-2",
        delta: -2,
        reason: "reviews contradict this requirement",
      });
    }
    if (
      list.length > 0 &&
      sources.size === 1 &&
      contradicts.length === 0 &&
      !explicit &&
      supports.length < 2
    ) {
      breakdown.push({
        requirementId,
        rule: "-1",
        delta: -1,
        reason: "only a single source mentions this requirement",
      });
    }
    if (supports.length > 0 && contradicts.length > 0) {
      conflicted = true;
    }
  }

  const score = breakdown.reduce((sum, line) => sum + line.delta, 0);
  return { score, conflicted, breakdown };
}
