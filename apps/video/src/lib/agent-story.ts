import { progressFraction } from "@sensitiv/shared";
import type { RunSnapshot, SnapshotEvent, SnapshotEvidence } from "../config/run-snapshot.ts";

// What the "agent at work" panel shows, read out of the run's own activity
// log. Every number and name here is one the worker wrote while the run was
// happening; the parsing is best-effort, so a line a newer worker phrases
// differently just leaves its part of the panel empty rather than inventing
// a value for it.

export interface OpenedPlace {
  name: string;
  /** Run seconds the place was opened. */
  at: number;
  /** Run seconds the last page for it was read, and what that found. */
  doneAt?: number;
  added: number;
}

export interface AgentStory {
  /** Run seconds the planner finished. */
  plannedAt?: number;
  queries: Array<{ text: string; at: number }>;
  osm?: { tagged: number; startedAt?: number; at: number };
  maps?: { startedAt: number; scanned?: number; scannedAt?: number; searchedAt?: number };
  opened: OpenedPlace[];
  /** Run seconds reading ended (the last opened place finished). */
  readingEndsAt?: number;
  merged?: { at: number; places: number };
  finished?: { at: number; places: number; evidence: number; conflicted: number };
  spotlight?: {
    place: string;
    evidence: SnapshotEvidence;
    /** Run seconds the page carrying this quote was read. */
    at: number;
  };
}

const RE = {
  planned: /planned \d+ requirement/,
  searching: /searching "([^"]+)"/,
  scanned: /→ (\d+) raw card\(s\)[^,]*, (\d+) place\(s\)/,
  searchTook: /query "[^"]+" took /,
  osmQuery: /\[openstreetmap\] querying/,
  osmTagged: /(\d+) tagged place\(s\)/,
  mapsStart: /\[google_maps\] (viewport|searching|working)/,
  opening: /\] opening (.+?) for: /,
  added: /\] (.+?): (?:detail page|website) added (\d+) evidence/,
  merging: /merging \d+ finding/,
  distinct: /(\d+) distinct place/,
  finished: /job finished: \w+ — (\d+) place\(s\), (\d+) evidence, (\d+) conflicted/,
};

function first(log: readonly SnapshotEvent[], re: RegExp): SnapshotEvent | undefined {
  return log.find((e) => re.test(e.message));
}

/** The best quote the spotlight place has for the requirement the user ticked. */
export function spotlightEvidence(
  run: RunSnapshot,
  placeIndex: number,
  requirementId: string,
): SnapshotEvidence | undefined {
  const place = run.places[placeIndex];
  if (!place) return undefined;
  const quoted = place.evidence.filter((e) => e.quote.trim() !== "");
  const pick = (list: SnapshotEvidence[]) =>
    list.reduce<SnapshotEvidence | undefined>(
      (best, e) => (best === undefined || e.confidence > best.confidence ? e : best),
      undefined,
    );
  return (
    pick(quoted.filter((e) => e.requirementId === requirementId && e.polarity === "supports")) ??
    pick(quoted.filter((e) => e.polarity === "supports")) ??
    pick(quoted)
  );
}

export function agentStory(
  run: RunSnapshot,
  options: { spotlightIndex: number; requirementId: string },
): AgentStory {
  const log = run.log;
  const story: AgentStory = { queries: [], opened: [] };

  story.plannedAt = first(log, RE.planned)?.t;

  for (const e of log) {
    const q = RE.searching.exec(e.message);
    if (q && !story.queries.some((x) => x.text === q[1])) {
      story.queries.push({ text: q[1]!, at: e.t });
    }
  }

  const osmStart = first(log, RE.osmQuery);
  const osmDone = log.find(
    (e) => e.message.includes("[openstreetmap]") && RE.osmTagged.test(e.message),
  );
  if (osmDone) {
    story.osm = {
      tagged: Number(RE.osmTagged.exec(osmDone.message)![1]),
      startedAt: osmStart?.t,
      at: osmDone.t,
    };
  }

  const mapsStart = first(log, RE.mapsStart);
  if (mapsStart) {
    const scanned = first(log, RE.scanned);
    story.maps = {
      startedAt: mapsStart.t,
      scanned: scanned ? Number(RE.scanned.exec(scanned.message)![2]) : undefined,
      scannedAt: scanned?.t,
      searchedAt: first(log, RE.searchTook)?.t,
    };
  }

  for (const e of log) {
    const opening = RE.opening.exec(e.message);
    if (opening) {
      const name = opening[1]!;
      if (!story.opened.some((o) => o.name === name)) {
        story.opened.push({ name, at: e.t, added: 0 });
      }
      continue;
    }
    const added = RE.added.exec(e.message);
    if (added) {
      const entry = story.opened.find((o) => o.name === added[1]);
      if (entry) {
        entry.added += Number(added[2]);
        entry.doneAt = e.t;
      }
    }
  }
  const lastDone = Math.max(...story.opened.map((o) => o.doneAt ?? 0), 0);
  if (lastDone > 0) story.readingEndsAt = lastDone;

  const merging = first(log, RE.merging);
  const distinct = first(log, RE.distinct);
  if (merging) {
    story.merged = {
      at: merging.t,
      places: distinct ? Number(RE.distinct.exec(distinct.message)![1]) : run.places.length,
    };
  }

  const finished = first(log, RE.finished);
  if (finished) {
    const m = RE.finished.exec(finished.message)!;
    story.finished = {
      at: finished.t,
      places: Number(m[1]),
      evidence: Number(m[2]),
      conflicted: Number(m[3]),
    };
  } else {
    story.finished = {
      at: run.durationSec,
      places: run.places.length,
      evidence: run.places.reduce((n, p) => n + p.evidence.length, 0),
      conflicted: run.places.filter((p) => p.conflicted).length,
    };
  }

  const place = run.places[options.spotlightIndex];
  const evidence = spotlightEvidence(run, options.spotlightIndex, options.requirementId);
  if (place && evidence) {
    // When the page that carried it was read, if the log says; otherwise late
    // in the run, which is when reading happens.
    const readAt = log.find(
      (e) => e.message.includes(`] ${place.name}: `) && RE.added.test(e.message),
    )?.t;
    story.spotlight = {
      place: place.name,
      evidence,
      at: readAt ?? run.durationSec * 0.7,
    };
  }

  return story;
}

/**
 * The activity line the status card shows at `runSec`: the newest message,
 * skipping the bare "[source] working" progress ticks, which say nothing.
 */
export function latestMessage(run: RunSnapshot, runSec: number): string | undefined {
  let latest: string | undefined;
  for (const e of run.log) {
    if (e.t > runSec) break;
    if (/^\[[\w-]+\] working$/.test(e.message)) continue;
    latest = e.message;
  }
  return latest;
}

/**
 * How full the progress bar is at `runSec`: the app's own `progressFraction`
 * of the newest marker, eased toward the next one as time passes between
 * them — the video's stand-in for the run page's creep.
 */
export function progressFractionAt(run: RunSnapshot, runSec: number): number {
  const markers = run.log.filter((e) => e.progress);
  let prev: { t: number; f: number } = { t: 0, f: 0 };
  for (const e of markers) {
    const f = progressFraction(e.progress!);
    if (e.t > runSec) {
      const span = e.t - prev.t;
      const k = span <= 0 ? 1 : (runSec - prev.t) / span;
      return prev.f + (Math.max(prev.f, f) - prev.f) * Math.min(1, Math.max(0, k));
    }
    prev = { t: e.t, f: Math.max(prev.f, f) };
  }
  return prev.f;
}

/** The newest progress marker at `runSec`, and the second it was written. */
export function latestProgress(
  run: RunSnapshot,
  runSec: number,
): { progress: NonNullable<SnapshotEvent["progress"]>; at: number } | undefined {
  let latest: { progress: NonNullable<SnapshotEvent["progress"]>; at: number } | undefined;
  for (const e of run.log) {
    if (e.t > runSec) break;
    if (e.progress) latest = { progress: e.progress, at: e.t };
  }
  return latest;
}
