import { maxAchievableScore, type Dossier, type JobEvent } from "@sensitiv/shared";
import { safePhotoUrl } from "@sensitiv/shared/safe-url";
import type { Job } from "@sensitiv/db";
import type { RunSnapshot, SnapshotEvent } from "../config/run-snapshot.ts";

// A stored run → the JSON the video replays. Pure, so what gets kept and what
// gets dropped is pinned by tests rather than by whoever last ran the script.

/**
 * A Google ACCOUNT picture — the reviewer's face, not the restaurant.
 *
 * The Maps scrape sometimes takes the avatar next to a review for a place's
 * photo (`lh3.googleusercontent.com/a/…`, `/a-/…`). Putting a stranger's face
 * on a restaurant card in a video is wrong twice over, so it never gets in.
 */
export function isAccountAvatar(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      /(^|\.)googleusercontent\.com$/i.test(parsed.hostname) &&
      /^\/a-?\//.test(parsed.pathname)
    );
  } catch {
    return false;
  }
}

/**
 * Log lines that are plumbing rather than narrative. A browser session id is
 * not a secret, but it names a recording on someone else's service and has no
 * business in a committed file.
 */
export function keepLogLine(message: string): boolean {
  return !/\bbrowser session\b/i.test(message);
}

const round = (n: number, places = 3) => {
  const f = 10 ** places;
  return Math.round(n * f) / f;
};

export interface SnapshotReport {
  snapshot: RunSnapshot;
  photosKept: number;
  avatarsDropped: string[];
  sampleSources: string[];
  unavailableSources: string[];
}

export function toSnapshot(
  job: Job,
  dossier: Dossier,
  events: readonly JobEvent[],
  importedAt: Date,
): SnapshotReport {
  const firstTs = events[0] ? Date.parse(events[0].ts) : job.startedAt ?? job.createdAt;
  const log: SnapshotEvent[] = events
    .filter((e) => keepLogLine(e.message))
    .map((e) => ({
      t: round(Math.max(0, (Date.parse(e.ts) - firstTs) / 1000), 1),
      level: e.level,
      message: e.message,
      ...(e.progress ? { progress: e.progress } : {}),
    }));

  const durationSec =
    job.startedAt !== null && job.finishedAt !== null
      ? round((job.finishedAt - job.startedAt) / 1000)
      : (log.at(-1)?.t ?? 0);

  const avatarsDropped: string[] = [];
  let photosKept = 0;
  const places = dossier.places.map((entry) => {
    const safe = safePhotoUrl(entry.place.thumbnailUrl);
    let photo: string | undefined;
    if (safe && isAccountAvatar(safe)) avatarsDropped.push(entry.place.name);
    else if (safe) {
      photo = safe;
      photosKept++;
    }
    return {
      name: entry.place.name,
      ...(entry.place.address ? { address: entry.place.address } : {}),
      ...(entry.place.category ? { category: entry.place.category } : {}),
      ...(entry.place.lat !== undefined ? { lat: entry.place.lat } : {}),
      ...(entry.place.lng !== undefined ? { lng: entry.place.lng } : {}),
      ...(photo ? { photo } : {}),
      score: round(entry.score),
      conflicted: entry.conflicted,
      breakdown: entry.breakdown.map((line) => ({
        requirementId: line.requirementId,
        rule: line.rule,
        delta: round(line.delta),
        weight: line.weight,
        ...(line.viaCategory ? { viaCategory: true } : {}),
        ...(line.discounted ? { discounted: true } : {}),
      })),
      evidence: entry.evidence.map((e) => ({
        requirementId: e.requirementId,
        polarity: e.polarity,
        claim: e.claim,
        quote: e.quote,
        source: e.source,
        ...(e.date ? { date: e.date } : {}),
        confidence: round(e.confidence),
      })),
      sources: entry.sources.map((s) => ({
        source: s.source,
        ...(s.rating !== undefined ? { rating: s.rating } : {}),
        ...(s.reviewCount !== undefined ? { reviewCount: s.reviewCount } : {}),
      })),
    };
  });

  const status = dossier.status;
  if (status !== "done" && status !== "partial") {
    throw new Error(`run ${job.id} is ${status}; only a finished run can be imported`);
  }

  const sourceModes = { ...dossier.sourceModes };
  const snapshot: RunSnapshot = {
    jobId: job.id,
    importedAt: importedAt.toISOString(),
    status,
    createdAt: new Date(job.createdAt).toISOString(),
    durationSec,
    request: job.requestText,
    location: {
      query: job.location.query,
      ...(job.location.lat !== undefined ? { lat: job.location.lat } : {}),
      ...(job.location.lng !== undefined ? { lng: job.location.lng } : {}),
      radiusKm: job.location.radiusKm,
      pinned: job.location.pinned === true,
    },
    ...(dossier.searchCenter ? { searchCenter: dossier.searchCenter } : {}),
    searchLang: dossier.searchLang,
    requirements: dossier.requirements.map((r) => ({
      id: r.id,
      label: r.label,
      weight: r.weight,
      ...(r.kind ? { kind: r.kind } : {}),
    })),
    intents: job.plannedIntentIds.length > 0 ? job.plannedIntentIds : job.intentIds,
    sourceModes,
    ...(dossier.quickSearch !== undefined ? { quickSearch: dossier.quickSearch } : {}),
    maxScore: round(
      maxAchievableScore(dossier.requirements, {
        withProximity: dossier.searchCenter !== undefined,
      }),
    ),
    places,
    log,
  };

  const byMode = (mode: string) =>
    Object.entries(sourceModes)
      .filter(([, m]) => m === mode)
      .map(([id]) => id);

  return {
    snapshot,
    photosKept,
    avatarsDropped,
    sampleSources: byMode("fixture"),
    unavailableSources: byMode("unavailable"),
  };
}
