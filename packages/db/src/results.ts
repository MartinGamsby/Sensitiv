import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNotNull, lt } from "drizzle-orm";
import { z } from "zod";
import {
  DossierReplaySchema,
  DossierSchema,
  EvidenceSchema,
  PlaceDetailSchema,
  PlaceSourceSchema,
  PlannedRequirementSchema,
  ScoreLineSchema,
  disclaimerFor,
  scorePlace,
  type Dossier,
  type DossierPlace,
  type DossierReplay,
  type Evidence,
  type PlaceDetail,
  type PlaceSource,
  type PlannedRequirement,
  type ScoreLine,
} from "@sensitiv/shared";
import {
  SUBJECT_REQUIREMENT_WEIGHT,
  getRequirement,
} from "@sensitiv/shared/catalog/index";
import { parseJsonColumn } from "./json.ts";
import type { DbHandle } from "./client.ts";
import { getJob, listJobsForUser, type Job } from "./jobs.ts";
import {
  evidence as evidenceTable,
  jobs,
  placeSources,
  places,
  replays,
} from "./schema.ts";

const ScoreBreakdownJsonSchema = z.array(ScoreLineSchema);

/** Insert or merge a place on `(job_id, canonical_key)`. Score/conflicted are left untouched. */
export async function upsertPlace(
  db: DbHandle,
  jobId: string,
  place: PlaceDetail,
): Promise<{ id: string }> {
  const parsed = PlaceDetailSchema.parse(place);
  const values = {
    id: randomUUID(),
    jobId,
    name: parsed.name,
    address: parsed.address ?? null,
    category: parsed.category ?? null,
    phone: parsed.phone ?? null,
    url: parsed.url ?? null,
    thumbnailUrl: parsed.thumbnailUrl ?? null,
    lat: parsed.lat ?? null,
    lng: parsed.lng ?? null,
    canonicalKey: parsed.canonicalKey,
  };

  const rows = await db
    .insert(places)
    .values(values)
    .onConflictDoUpdate({
      target: [places.jobId, places.canonicalKey],
      set: {
        name: values.name,
        address: values.address,
        category: values.category,
        phone: values.phone,
        url: values.url,
        thumbnailUrl: values.thumbnailUrl,
        lat: values.lat,
        lng: values.lng,
      },
    })
    .returning({ id: places.id });

  const row = rows[0];
  if (!row) throw new Error("upsertPlace: upsert returned no row");
  return { id: row.id };
}

/** Worker-written ranking so the dossier reads without recomputation (Section 7).
 *
 *  `breakdown` is the per-rule explanation that sums to `score`. Omitting it
 *  leaves the column NULL, which reads as "this score was never broken down" —
 *  never as "it broke down to nothing". */
export async function setPlaceScore(
  db: DbHandle,
  placeId: string,
  score: number,
  conflicted: boolean,
  breakdown?: readonly ScoreLine[],
): Promise<void> {
  await db
    .update(places)
    .set({
      score,
      conflicted: conflicted ? 1 : 0,
      scoreBreakdownJson:
        breakdown === undefined
          ? null
          : JSON.stringify(ScoreBreakdownJsonSchema.parse(breakdown)),
    })
    .where(eq(places.id, placeId));
}

export async function addPlaceSource(
  db: DbHandle,
  placeId: string,
  source: PlaceSource,
  rawJson?: unknown,
): Promise<{ id: string }> {
  const parsed = PlaceSourceSchema.parse(source);
  const id = randomUUID();
  await db.insert(placeSources).values({
    id,
    placeId,
    source: parsed.source,
    sourceUrl: parsed.sourceUrl,
    rating: parsed.rating ?? null,
    reviewCount: parsed.reviewCount ?? null,
    rawJson: rawJson === undefined ? null : JSON.stringify(rawJson),
  });
  return { id };
}

export async function addEvidence(
  db: DbHandle,
  placeId: string,
  input: Evidence,
): Promise<{ id: string }> {
  const parsed = EvidenceSchema.parse(input);
  const id = randomUUID();
  await db.insert(evidenceTable).values({
    id,
    placeId,
    requirementId: parsed.requirementId,
    claim: parsed.claim,
    polarity: parsed.polarity,
    quote: parsed.quote,
    source: parsed.source,
    sourceUrl: parsed.sourceUrl,
    date: parsed.date ?? null,
    confidence: parsed.confidence,
  });
  return { id };
}

export interface ReplayInput {
  solariSessionId: string;
  /** Absent for an "unavailable" replay — no safe URL survived either. */
  replayUrl?: string;
  expiresAt?: number;
  adapterId?: string;
  findingCount?: number;
  status?: "stored" | "link_only" | "empty" | "unavailable" | "too_large" | "expired";
  storedPath?: string;
  sizeBytes?: number;
  contentType?: string;
}

export async function addReplay(
  db: DbHandle,
  jobId: string,
  input: ReplayInput,
): Promise<{ id: string }> {
  const id = randomUUID();
  await db.insert(replays).values({
    id,
    jobId,
    solariSessionId: input.solariSessionId,
    replayUrl: input.replayUrl ?? null,
    expiresAt: input.expiresAt ?? null,
    adapterId: input.adapterId ?? null,
    findingCount: input.findingCount ?? null,
    status: input.status ?? null,
    storedPath: input.storedPath ?? null,
    sizeBytes: input.sizeBytes ?? null,
    contentType: input.contentType ?? null,
  });
  return { id };
}

/**
 * Look a replay up by id AND job id — never trust a bare replay id from a
 * request. Returns `undefined` when the replay does not exist or belongs to
 * a different job (the download route folds that into the same 404 as
 * "not yours" for the job itself).
 */
export async function getReplayForJob(
  db: DbHandle,
  jobId: string,
  replayId: string,
): Promise<typeof replays.$inferSelect | undefined> {
  const rows = await db
    .select()
    .from(replays)
    .where(and(eq(replays.id, replayId), eq(replays.jobId, jobId)));
  return rows[0];
}

/**
 * The stored photo URL for one place in one job, or nothing.
 *
 * Keyed by `canonical_key` rather than the place's row id because the dossier
 * never carries that id — `PlaceDetail` is the shape the UI has, and
 * `canonical_key` is unique per job, which is exactly the uniqueness this
 * lookup needs. The key comes off the request path, so it is a bound
 * parameter in a `where`, never interpolated.
 *
 * `jobId` is checked against `userId` by the CALLER (`getJob`) before this
 * runs; this query then scopes to that job, so no place from another user's
 * run is reachable even with its canonical key guessed.
 */
export async function getPlacePhotoUrl(
  db: DbHandle,
  jobId: string,
  canonicalKey: string,
): Promise<string | undefined> {
  const rows = await db
    .select({ thumbnailUrl: places.thumbnailUrl })
    .from(places)
    .where(and(eq(places.jobId, jobId), eq(places.canonicalKey, canonicalKey)))
    .limit(1);
  return rows[0]?.thumbnailUrl ?? undefined;
}

/**
 * Stored replays whose job finished before `cutoffMs` — the retention sweep's
 * work list.
 *
 * Deliberately NOT scoped by `user_id`, unlike every other read in this file.
 * Retention is a property of the disk, not of a request: the worker is the
 * only caller, it is trusted (see `getJobById`), and a sweep that could only
 * see one user's rows would leave the rest on disk forever. Nothing here
 * reaches a response.
 *
 * Keyed off `jobs.created_at` rather than a per-replay timestamp because the
 * `replays` table has no creation column, and a replay is exactly as old as
 * the run that produced it.
 */
export async function listReplaysToPrune(
  db: DbHandle,
  cutoffMs: number,
): Promise<Array<{ id: string; storedPath: string }>> {
  const rows = await db
    .select({ id: replays.id, storedPath: replays.storedPath })
    .from(replays)
    .innerJoin(jobs, eq(jobs.id, replays.jobId))
    .where(and(isNotNull(replays.storedPath), lt(jobs.createdAt, cutoffMs)));
  return rows.flatMap((row) =>
    row.storedPath ? [{ id: row.id, storedPath: row.storedPath }] : [],
  );
}

/**
 * Mark a replay's bytes as gone, keeping the row.
 *
 * The row is what lets the dossier still say WHICH source recorded and how
 * many findings it contributed; deleting it would silently rewrite the history
 * of a finished run. `status: "expired"` is distinct from `"unavailable"` so
 * "we deleted this after N days" does not read as "there was never anything
 * here". The presigned `replay_url` goes too — it expired long before the file
 * did, and a dead bearer link is worth nothing.
 */
export async function markReplayExpired(
  db: DbHandle,
  replayId: string,
): Promise<void> {
  await db
    .update(replays)
    .set({
      status: "expired",
      storedPath: null,
      sizeBytes: null,
      contentType: null,
      replayUrl: null,
      expiresAt: null,
    })
    .where(eq(replays.id, replayId));
}

function toPlaceDetail(row: typeof places.$inferSelect): PlaceDetail {
  return PlaceDetailSchema.parse({
    name: row.name,
    address: row.address ?? undefined,
    lat: row.lat ?? undefined,
    lng: row.lng ?? undefined,
    category: row.category ?? undefined,
    phone: row.phone ?? undefined,
    url: row.url ?? undefined,
    thumbnailUrl: row.thumbnailUrl ?? undefined,
    canonicalKey: row.canonicalKey,
  });
}

function toPlaceSource(row: typeof placeSources.$inferSelect): PlaceSource {
  return PlaceSourceSchema.parse({
    source: row.source,
    sourceUrl: row.sourceUrl,
    rating: row.rating ?? undefined,
    reviewCount: row.reviewCount ?? undefined,
  });
}

function toEvidence(row: typeof evidenceTable.$inferSelect): Evidence {
  return EvidenceSchema.parse({
    requirementId: row.requirementId,
    claim: row.claim,
    polarity: row.polarity,
    quote: row.quote,
    source: row.source,
    sourceUrl: row.sourceUrl,
    date: row.date ?? undefined,
    confidence: row.confidence,
  });
}

/**
 * What this run planned to research, as well as it can be known.
 *
 * `job.plannedRequirements` is the answer for anything planned since the worker
 * started recording it. For an older run the column is NULL and the job falls
 * back to the CHIPS, which is not the whole plan: a free-text requirement the
 * planner minted ("Mexican restaurant") is missing, and re-scoring without it
 * ranks a chocolate shop above a taqueria on a search for a taqueria.
 *
 * So the gaps are filled from the stored `score_breakdown_json`, which is the
 * only record those runs kept of their own plan. Two deliberate choices in what
 * comes back:
 *
 *   - a CATALOG requirement takes its weight from the catalog, not from the
 *     stored line, so a rubric change still reaches an old dossier — the point
 *     of re-scoring at all;
 *   - a reconstructed `custom_<slug>` recovers its `kind` from its recorded
 *     WEIGHT, which is an exact record rather than a guess:
 *     `makeCustomRequirement` only ever writes `DEFAULT_REQUIREMENT_WEIGHT` or
 *     `SUBJECT_REQUIREMENT_WEIGHT`, so the latter means the planner called it a
 *     subject. A run from before `kind` existed wrote the default for
 *     everything and comes back a preference, which is the old behaviour.
 *
 * A no-op for any run whose plan was recorded properly.
 */
/** `custom_mexican_restaurant` -> `mexican restaurant`. Presentation only, and
 *  only for a requirement the catalog does not know. */
function humanizeRequirementId(id: string): string {
  return id.replace(/^custom[_-]/, "").replace(/[_-]+/g, " ").trim() || id;
}

/** A place row's stored breakdown, which for a pre-`planned_requirements_json`
 *  run is the only surviving record of what that run planned. Malformed or
 *  absent reads as none. */
function storedBreakdown(row: typeof places.$inferSelect): ScoreLine[] {
  if (row.scoreBreakdownJson === null) return [];
  return parseJsonColumn(
    ScoreBreakdownJsonSchema,
    row.scoreBreakdownJson,
    `places.score_breakdown_json (place ${row.id})`,
  );
}

function effectiveRequirements(
  job: Job,
  breakdowns: readonly ScoreLine[][],
): PlannedRequirement[] {
  // A stored requirement carries the weight the catalog had the day it was
  // enqueued. Refresh it from the catalog so "change a weight and every dossier
  // re-ranks" is true rather than nearly true — a run from before the safety
  // chips doubled would otherwise keep scoring celiac at the old three.
  // A `custom_<slug>` has no catalog entry to consult, so its recorded weight
  // stands; that is the best record of it there is.
  const out = job.plannedRequirements.map((requirement) => {
    const catalog = getRequirement(requirement.catalogId ?? requirement.id);
    return catalog ? { ...requirement, weight: catalog.weight } : requirement;
  });
  const known = new Set(out.map((r) => r.id));
  for (const breakdown of breakdowns) {
    for (const line of breakdown) {
      if (line.requirementId === "" || known.has(line.requirementId)) continue;
      known.add(line.requirementId);
      const catalog = getRequirement(line.requirementId);
      const subject = !catalog && line.weight === SUBJECT_REQUIREMENT_WEIGHT;
      out.push(
        PlannedRequirementSchema.parse({
          id: line.requirementId,
          ...(catalog ? { catalogId: catalog.id } : {}),
          // `custom_mexican_restaurant` -> "mexican restaurant". The slug is the
          // only label those runs kept, and the label is what a subject with no
          // stored `categoryHints` matches a place's category against — so the
          // `custom_` prefix has to come off or it becomes a term of its own.
          label: catalog?.label.en ?? humanizeRequirementId(line.requirementId),
          intentIds: [],
          must: [],
          nice: [],
          weight: catalog?.weight ?? line.weight,
          satisfiedBy: [],
          ...(subject ? { kind: "subject" as const } : {}),
        }),
      );
    }
  }
  return out;
}

/**
 * The score for one place, worked out here rather than read off the row.
 *
 * A score is not a stored fact — it is a reading of the stored facts, and the
 * facts are the quoted evidence. Freezing the reading into `places.score` at run
 * time meant the evidence was re-read on every page load while the opinion about
 * it never was: a rubric change reached new runs only, and an old dossier had no
 * way to notice its ranking was stale. Recomputing here means changing a weight
 * in `scorePlace` re-ranks every dossier ever run.
 *
 * `places.score` is still written by the worker — it needs a ranking while the
 * run is in flight, and it is the index this query orders by before the
 * recomputed scores replace it — but nothing on the read path trusts it.
 */
function rescore(
  job: Job,
  requirements: readonly PlannedRequirement[],
  place: PlaceDetail,
  evidence: readonly Evidence[],
): { score: number; breakdown: ScoreLine[]; conflicted: boolean } {
  return scorePlace(evidence, {
    // The PLANNED requirements, which carry the weight and `kind` this run
    // scored against — not the chips. Reading the chips here is what made the
    // dossier divide by a ceiling that had never heard of half the run.
    requirements,
    center: job.searchCenter,
    radiusKm: job.location.radiusKm,
    // `category` as well as the coordinates: a subject requirement is judged
    // against the place's own category, which is often the only thing that
    // settles it for an OpenStreetMap place.
    place: { lat: place.lat, lng: place.lng, category: place.category },
  });
}

/**
 * Assemble the dossier: join places + sources + evidence + replays for a job the
 * caller owns. Returns `undefined` when the job does not exist or belongs to
 * another user.
 *
 * Scores and their breakdowns are DERIVED from the stored evidence on every
 * read — see `rescore`. The SQL ordering below is only a starting point; the
 * final ranking is applied after scoring.
 */
export async function getDossier(
  db: DbHandle,
  jobId: string,
  userId: string,
): Promise<Dossier | undefined> {
  const job = await getJob(db, jobId, userId);
  if (!job) return undefined;

  const placeRows = await db
    .select()
    .from(places)
    .where(eq(places.jobId, jobId))
    .orderBy(desc(places.score), places.canonicalKey);

  const requirements = effectiveRequirements(job, placeRows.map(storedBreakdown));

  const dossierPlaces: DossierPlace[] = [];
  for (const placeRow of placeRows) {
    const sourceRows = await db
      .select()
      .from(placeSources)
      .where(eq(placeSources.placeId, placeRow.id));
    const evidenceRows = await db
      .select()
      .from(evidenceTable)
      .where(eq(evidenceTable.placeId, placeRow.id));

    const place = toPlaceDetail(placeRow);
    const evidence = evidenceRows.map(toEvidence);
    const scored = rescore(job, requirements, place, evidence);

    dossierPlaces.push({
      place,
      sources: sourceRows.map(toPlaceSource),
      evidence,
      score: scored.score,
      breakdown: scored.breakdown,
      conflicted: scored.conflicted,
    });
  }

  // Rank on what we just computed. The SQL `ORDER BY places.score` above is the
  // stored, possibly-stale number; it keeps the query result deterministic and
  // gives ties a stable tiebreak, and this is what the reader actually sees.
  dossierPlaces.sort((a, b) =>
    compareRanked(a.score, a.place.canonicalKey, {
      score: b.score,
      canonicalKey: b.place.canonicalKey,
    }),
  );

  const replayRows = await db
    .select()
    .from(replays)
    .where(eq(replays.jobId, jobId));

  return DossierSchema.parse({
    jobId: job.id,
    status: job.status,
    uiLocale: job.uiLocale,
    searchLang: job.searchLang,
    // The PLANNED requirements: the dossier renders per-requirement sorting and
    // divides by `maxAchievableScore(...)` off this list, and both have to see
    // every requirement the run actually scored.
    requirements,
    searchCenter: job.searchCenter,
    recordSession: job.recordSession,
    quickSearch: job.quickSearch,
    places: dossierPlaces,
    replays: replayRows.map(toDossierReplay),
    disclaimer: disclaimerFor(job.uiLocale),
    sourceModes: job.sourceModes ?? {},
  });
}

export interface JobSummary {
  job: Job;
  /** 0 when the run found nothing. */
  placeCount: number;
  /** Absent when the run found nothing. Same ordering as `getDossier`
   *  (score desc, canonical_key) so this matches the dossier's first card. */
  topPlace?: { name: string; score: number; conflicted: boolean };
}

/**
 * History list backing query: the user's jobs plus a per-job place count and
 * best-scoring place, without an N+1 loop. `jobIds` are derived from the
 * already-scoped `listJobsForUser` result — never from request input — so
 * this stays inside the `user_id` boundary like every other job read.
 */
export async function listJobSummariesForUser(
  db: DbHandle,
  userId: string,
  limit = 50,
): Promise<JobSummary[]> {
  const jobList = await listJobsForUser(db, userId, limit);
  if (jobList.length === 0) return [];

  const jobIds = jobList.map((job) => job.id);
  const jobById = new Map(jobList.map((job) => [job.id, job]));
  // Two queries, not an N+1 loop: every place for these job ids, then every
  // piece of evidence for those places.
  //
  // The evidence is here because the top place is RE-SCORED, exactly as
  // `getDossier` re-scores it. Reading `places.score` was one round trip
  // cheaper and could name a different winner than the dossier's own first
  // card the moment the rubric moved — two screens disagreeing about which
  // place a run found, which is the drift this whole change exists to stop.
  const placeRows = await db
    .select()
    .from(places)
    .where(inArray(places.jobId, jobIds))
    .orderBy(desc(places.score), places.canonicalKey);

  const evidenceByPlace = new Map<string, Evidence[]>();
  if (placeRows.length > 0) {
    const evidenceRows = await db
      .select()
      .from(evidenceTable)
      .where(
        inArray(
          evidenceTable.placeId,
          placeRows.map((row) => row.id),
        ),
      );
    for (const row of evidenceRows) {
      const list = evidenceByPlace.get(row.placeId) ?? [];
      list.push(toEvidence(row));
      evidenceByPlace.set(row.placeId, list);
    }
  }

  // Same reconstruction the dossier does, per job, so a legacy run's top place
  // is picked against the same requirement list on both screens.
  const rowsByJob = new Map<string, (typeof placeRows)[number][]>();
  for (const row of placeRows) {
    const list = rowsByJob.get(row.jobId) ?? [];
    list.push(row);
    rowsByJob.set(row.jobId, list);
  }
  const requirementsByJob = new Map<string, PlannedRequirement[]>();
  for (const [id, rows] of rowsByJob) {
    const job = jobById.get(id);
    if (job) requirementsByJob.set(id, effectiveRequirements(job, rows.map(storedBreakdown)));
  }

  const countByJob = new Map<string, number>();
  const topByJob = new Map<
    string,
    { name: string; score: number; conflicted: boolean; canonicalKey: string }
  >();
  for (const row of placeRows) {
    countByJob.set(row.jobId, (countByJob.get(row.jobId) ?? 0) + 1);
    const job = jobById.get(row.jobId);
    if (!job) continue;
    const place = toPlaceDetail(row);
    const scored = rescore(
      job,
      requirementsByJob.get(row.jobId) ?? job.plannedRequirements,
      place,
      evidenceByPlace.get(row.id) ?? [],
    );
    const best = topByJob.get(row.jobId);
    // The comparator `getDossier` sorts with, applied explicitly. The SQL
    // order cannot break a tie here: it sorts on the STORED score first, and
    // two places that re-score level can have stored different ones.
    if (!best || compareRanked(scored.score, row.canonicalKey, best) < 0) {
      topByJob.set(row.jobId, {
        name: row.name,
        score: scored.score,
        conflicted: scored.conflicted,
        canonicalKey: row.canonicalKey,
      });
    }
  }

  return jobList.map((job) => {
    const top = topByJob.get(job.id);
    return {
      job,
      placeCount: countByJob.get(job.id) ?? 0,
      topPlace: top
        ? { name: top.name, score: top.score, conflicted: top.conflicted }
        : undefined,
    };
  });
}

/** Dossier order: score descending, then canonical key. Negative when `score`
 *  / `canonicalKey` ranks ahead of `other`. The one ordering both the dossier
 *  and the History list use, so they name the same first place. */
function compareRanked(
  score: number,
  canonicalKey: string,
  other: { score: number; canonicalKey: string },
): number {
  return other.score - score || canonicalKey.localeCompare(other.canonicalKey);
}

/** A `NULL` status (every pre-existing row, before this change) maps to
 *  `"unavailable"` — never rendered as a live link. `storedPath` is
 *  deliberately NOT exposed here: the download route resolves it
 *  server-side from the row id, so the dossier never carries a filesystem
 *  path to the client. */
function toDossierReplay(row: typeof replays.$inferSelect): DossierReplay {
  return DossierReplaySchema.parse({
    id: row.id,
    adapterId: row.adapterId ?? undefined,
    status: row.status ?? "unavailable",
    findingCount: row.findingCount ?? undefined,
    sizeBytes: row.sizeBytes ?? undefined,
    url: row.replayUrl || undefined,
    expiresAt: row.expiresAt ?? undefined,
  });
}
