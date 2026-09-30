import { MAX_REQUIREMENT_BASE, distanceKm, scorePercent } from "@sensitiv/shared";
import { isValidRequirementId } from "@sensitiv/shared/catalog/index";
import type { RunSnapshot, SnapshotEvidence, SnapshotLine, SnapshotPlace } from "../config/run-snapshot.ts";

// The dossier's read-side arithmetic, ported from the web app so the video
// shows exactly the numbers the app would: `requirement-marks.ts` (the pills
// on a card), `evidenceFor` and `consensusFor` (the detail view). Nothing here
// re-scores anything — it reads the breakdown the worker stored.

export type MarkTone = "ok" | "warn" | "danger" | "neutral";

export interface Mark {
  requirementId: string;
  delta: number;
  weight: number;
  settled: boolean;
  conflicted: boolean;
  fromChip: boolean;
  /** Percent of what this requirement could contribute; undefined = "?". */
  percent?: number;
  tone: MarkTone;
}

const POSITIVE_RULES = new Set(["explicit", "supported", "corroborated"]);

export function requirementMarks(breakdown: readonly SnapshotLine[]): Mark[] {
  const byId = new Map<string, Omit<Mark, "percent" | "tone">>();
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
    mark.weight = Math.max(mark.weight, line.weight);
    if (line.rule !== "unverified") mark.settled = true;
    byId.set(line.requirementId, mark);
  }
  for (const line of breakdown) {
    const mark = byId.get(line.requirementId);
    if (!mark || line.rule !== "contradicted") continue;
    mark.conflicted = breakdown.some(
      (other) => other.requirementId === line.requirementId && POSITIVE_RULES.has(other.rule),
    );
  }
  return [...byId.values()]
    .sort(
      (a, b) =>
        Number(b.fromChip) - Number(a.fromChip) ||
        b.weight - a.weight ||
        b.delta - a.delta ||
        a.requirementId.localeCompare(b.requirementId),
    )
    .map((mark) => ({
      ...mark,
      percent: mark.settled
        ? scorePercent(mark.delta, MAX_REQUIREMENT_BASE * mark.weight)
        : undefined,
      tone: mark.conflicted
        ? "warn"
        : !mark.settled
          ? "neutral"
          : mark.delta > 0
            ? "ok"
            : mark.delta < 0
              ? "danger"
              : "neutral",
    }));
}

/** The overall "Match N%" a card shows. */
export function placePercent(run: RunSnapshot, place: SnapshotPlace): number | undefined {
  return scorePercent(place.score, run.maxScore);
}

/** The claim a score line was built on, and who said anything about it. */
export function evidenceFor(
  evidence: readonly SnapshotEvidence[],
  line: SnapshotLine,
): { claim?: string; sources: string[] } {
  if (line.rule === "proximity" || line.requirementId === "") return { sources: [] };
  const mine = evidence.filter((e) => e.requirementId === line.requirementId);
  const wanted =
    line.rule === "contradicted"
      ? mine.filter((e) => e.polarity === "contradicts")
      : mine.filter((e) => e.polarity === "supports");
  const strongest = wanted.reduce<SnapshotEvidence | undefined>(
    (best, e) => (best === undefined || e.confidence > best.confidence ? e : best),
    undefined,
  );
  return { claim: strongest?.claim, sources: [...new Set(mine.map((e) => e.source))] };
}

export type Consensus = "agreed" | "conflicted" | "single";

export function consensusFor(evidence: readonly SnapshotEvidence[]): Consensus {
  const supports = evidence.some((e) => e.polarity === "supports");
  const contradicts = evidence.some((e) => e.polarity === "contradicts");
  if (supports && contradicts) return "conflicted";
  return new Set(evidence.map((e) => e.source)).size <= 1 ? "single" : "agreed";
}

/** Evidence grouped by requirement, in first-seen order. */
export function groupByRequirement(
  evidence: readonly SnapshotEvidence[],
): Array<{ requirementId: string; evidence: SnapshotEvidence[] }> {
  const groups = new Map<string, SnapshotEvidence[]>();
  for (const e of evidence) {
    const list = groups.get(e.requirementId) ?? [];
    list.push(e);
    groups.set(e.requirementId, list);
  }
  return [...groups.entries()].map(([requirementId, list]) => ({ requirementId, evidence: list }));
}

/** Kilometres from the run's centre, to two decimals, as the dossier shows. */
export function placeDistanceKm(run: RunSnapshot, place: SnapshotPlace): number | undefined {
  if (!run.searchCenter || place.lat === undefined || place.lng === undefined) return undefined;
  return Math.round(distanceKm(run.searchCenter, { lat: place.lat, lng: place.lng }) * 100) / 100;
}

/**
 * The dossier's warning strips, as the app shows them: sources that returned
 * recorded sample data, and sources that could not be searched at all.
 */
export function dossierNotices(
  run: RunSnapshot,
): Array<{ kind: "sampleData" | "unavailable"; sources: string[] }> {
  const byMode = (mode: string) =>
    Object.entries(run.sourceModes)
      .filter(([, m]) => m === mode)
      .map(([id]) => id);
  const notices: Array<{ kind: "sampleData" | "unavailable"; sources: string[] }> = [];
  const sample = byMode("fixture");
  if (sample.length > 0) notices.push({ kind: "sampleData", sources: sample });
  const unavailable = byMode("unavailable");
  if (unavailable.length > 0) notices.push({ kind: "unavailable", sources: unavailable });
  return notices;
}

/** `+5.85` / `-1.7` / `0` — signed, one decimal. */
export function formatDelta(delta: number): string {
  const rounded = Math.round(delta * 10) / 10;
  return `${rounded > 0 ? "+" : ""}${rounded}`;
}

/** `diet:gluten_free=yes` — an OpenStreetMap tag rather than prose. */
export function parseTagQuote(quote: string): { key: string; value: string } | undefined {
  const match = /^([a-z][a-z0-9_:-]*)=(\S+)$/.exec(quote.trim());
  return match ? { key: match[1]!, value: match[2]! } : undefined;
}
