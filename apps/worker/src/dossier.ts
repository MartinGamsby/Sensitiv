// Writes the dossier through the @sensitiv/db repos: place -> sources -> evidence
// -> score, then replay URLs. `finishJob` is the runner's call, not this module's.
import {
  addEvidence,
  addPlaceSource,
  addReplay,
  setPlaceScore,
  upsertPlace,
  type DbHandle,
} from "@sensitiv/db";
import type { PlannedRequirement } from "@sensitiv/shared";
import type { MergedPlace } from "./merge.ts";
import { scorePlace, type ScoreLine } from "./score.ts";
import type { JobLogLevel } from "./logger.ts";

export interface DossierReplay {
  sessionId: string;
  adapterId: string;
  findingCount: number;
  status: "stored" | "link_only" | "empty" | "unavailable" | "too_large";
  /** Presigned Solari URL, when the download/store path left one live.
   *  Absent for `"unavailable"` — nothing survived at all. */
  url?: string;
  /** Unix ms. Paired with `url`. */
  expiresAt?: number;
  /** Repo-root-relative, set only for `status: "stored"`. */
  storedPath?: string;
  sizeBytes?: number;
  contentType?: string;
}

export interface DossierWriteResult {
  /** How many places the dossier actually holds — after the cap. */
  placeCount: number;
  /** How many the cap left out. `0` on a run that fit. */
  droppedCount: number;
  evidenceCount: number;
  conflictedCount: number;
  /** Per-place score breakdown, keyed by canonical key (the UI shows it). */
  breakdown: Record<string, ScoreLine[]>;
}

/**
 * How many places a dossier keeps.
 *
 * A dining search over a dense neighbourhood merges to thirty-odd places, and
 * a list that long is not a ranked answer — it is the raw result set with a
 * number beside each row. The tail is also the weakest part of it: past the
 * first dozen, places are there because a query matched, not because anything
 * settled a requirement.
 *
 * The cap is applied AFTER scoring, so what survives is the top of the
 * ranking rather than whatever the adapters happened to return first, and
 * BEFORE persisting, so every later reader — the dossier page, the sort
 * control, the History summary — sees the same bounded set. Nothing downstream
 * filters, so the dossier holds at most this many places under every ordering.
 */
export const MAX_DOSSIER_PLACES = 15;

type Log = (level: JobLogLevel, message: string) => Promise<void>;

export async function writeDossier(
  db: DbHandle,
  jobId: string,
  merged: readonly MergedPlace[],
  replays: readonly DossierReplay[],
  log: Log,
  /** The run's planned requirements — supplies each one's scoring weight and
   *  lets a requirement no source mentioned still show as `unverified`. */
  requirements: readonly PlannedRequirement[] = [],
  /** Where the search was centred and how wide it was, for the proximity term. */
  area: { center?: { lat: number; lng: number }; radiusKm?: number } = {},
): Promise<DossierWriteResult> {
  let evidenceCount = 0;
  let conflictedCount = 0;
  const breakdown: Record<string, ScoreLine[]> = {};

  // Score everything first: the cap below has to cut the bottom of the
  // RANKING, and a place's rank is not known until every place has a score.
  const scoredAll = merged.map((place) => ({
    place,
    scored: scorePlace(place.evidence, {
      requirements,
      center: area.center,
      radiusKm: area.radiusKm,
      place: place.place,
    }),
  }));
  // Canonical key breaks ties, matching `getDossier`'s own
  // `(score desc, canonical_key)` ordering so the cap keeps exactly the
  // places the dossier would have shown first.
  scoredAll.sort(
    (a, b) =>
      b.scored.score - a.scored.score ||
      a.place.place.canonicalKey.localeCompare(b.place.place.canonicalKey),
  );

  const kept = scoredAll.slice(0, MAX_DOSSIER_PLACES);
  const dropped = scoredAll.slice(MAX_DOSSIER_PLACES);
  if (dropped.length > 0) {
    const cutoff = kept[kept.length - 1]!.scored.score;
    await log(
      "info",
      `kept the top ${kept.length} of ${scoredAll.length} place(s) — ` +
        `${dropped.length} scored below ${cutoff >= 0 ? "+" : ""}${cutoff}`,
    );
    // Named, once, quietly: "what did it leave out" is a fair question and the
    // activity log is where a run's own reasoning already lives.
    await log(
      "debug",
      `left out: ${dropped.map((d) => d.place.place.name).join(", ")}`,
    );
  }

  for (const { place, scored } of kept) {
    const { id } = await upsertPlace(db, jobId, place.place);
    for (const source of place.sources) await addPlaceSource(db, id, source);
    for (const item of place.evidence) {
      await addEvidence(db, id, item);
      evidenceCount += 1;
    }

    await setPlaceScore(db, id, scored.score, scored.conflicted, scored.breakdown);
    breakdown[place.place.canonicalKey] = scored.breakdown;

    if (scored.conflicted) {
      conflictedCount += 1;
      await log(
        "warn",
        `${place.place.name}: supporting AND contradicting evidence — kept, flagged amber`,
      );
    }
    await log(
      "info",
      `scored ${place.place.name}: ${scored.score >= 0 ? "+" : ""}${scored.score} ` +
        `(${place.sources.length} source${place.sources.length === 1 ? "" : "s"}, ${place.evidence.length} evidence)`,
    );
  }

  for (const replay of replays) {
    await addReplay(db, jobId, {
      solariSessionId: replay.sessionId,
      replayUrl: replay.url,
      expiresAt: replay.expiresAt,
      adapterId: replay.adapterId,
      findingCount: replay.findingCount,
      status: replay.status,
      storedPath: replay.storedPath,
      sizeBytes: replay.sizeBytes,
      contentType: replay.contentType,
    });
    await log("info", `attached replay for ${replay.adapterId} (${replay.status})`);
  }

  return {
    placeCount: kept.length,
    droppedCount: dropped.length,
    evidenceCount,
    conflictedCount,
    breakdown,
  };
}
