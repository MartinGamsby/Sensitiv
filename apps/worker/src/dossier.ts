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
import type { MergedPlace } from "./merge.ts";
import { scorePlace, type ScoreLine } from "./score.ts";
import type { JobLogLevel } from "./logger.ts";

export interface DossierReplay {
  sessionId: string;
  url: string;
}

export interface DossierWriteResult {
  placeCount: number;
  evidenceCount: number;
  conflictedCount: number;
  /** Per-place score breakdown, keyed by canonical key (the UI shows it). */
  breakdown: Record<string, ScoreLine[]>;
}

type Log = (level: JobLogLevel, message: string) => Promise<void>;

export async function writeDossier(
  db: DbHandle,
  jobId: string,
  merged: readonly MergedPlace[],
  replays: readonly DossierReplay[],
  log: Log,
): Promise<DossierWriteResult> {
  let evidenceCount = 0;
  let conflictedCount = 0;
  const breakdown: Record<string, ScoreLine[]> = {};

  for (const place of merged) {
    const { id } = await upsertPlace(db, jobId, place.place);
    for (const source of place.sources) await addPlaceSource(db, id, source);
    for (const item of place.evidence) {
      await addEvidence(db, id, item);
      evidenceCount += 1;
    }

    const scored = scorePlace(place.evidence);
    await setPlaceScore(db, id, scored.score, scored.conflicted);
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
    });
    await log("info", `attached replay for session ${replay.sessionId}`);
  }

  return {
    placeCount: merged.length,
    evidenceCount,
    conflictedCount,
    breakdown,
  };
}
