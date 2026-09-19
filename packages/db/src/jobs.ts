import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import {
  JobStatusSchema,
  LocationSchema,
  PlannedRequirementSchema,
  SourceModeSchema,
  UiLocaleSchema,
  type JobStatus,
  type Location,
  type LocationInput,
  type PlannedRequirement,
  type SourceMode,
  type UiLocale,
} from "@sensitiv/shared";
import type { DbHandle } from "./client.ts";
import { parseJsonColumn } from "./json.ts";
import {
  evidence,
  jobEvents,
  jobs,
  placeSources,
  places,
  replays,
} from "./schema.ts";

const RequirementsJsonSchema = z.array(PlannedRequirementSchema);
const IntentIdsJsonSchema = z.array(z.string());
const SourceModesJsonSchema = z.record(SourceModeSchema);

export interface Job {
  id: string;
  userId: string;
  status: JobStatus;
  location: Location;
  requestText: string;
  /** What the USER asked for — the chips, as the route derived them. */
  requirements: PlannedRequirement[];
  intentIds: string[];
  /**
   * What the PLANNER decided: the chips plus whatever the free text implied,
   * carrying the weight and `kind` this run scores against.
   *
   * Falls back to `requirements` / `intentIds` for a job planned before the
   * column existed, which is what those runs scored against anyway. Read this,
   * not `requirements`, anywhere a score or a ceiling is computed.
   */
  plannedRequirements: PlannedRequirement[];
  plannedIntentIds: string[];
  searchLang: string;
  uiLocale: UiLocale;
  timeoutSec: number;
  errorText: string | null;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  /** `undefined` for a NULL column — every pre-existing run, before this
   *  change. Render that as "not recorded", never as "live". */
  sourceModes: Record<string, SourceMode> | undefined;
  /** Whether this run asked Solari to record its browser sessions.
   *  `undefined` for a NULL column — every run created before the flag
   *  existed. The worker treats anything other than `true` as "do not
   *  record"; the UI renders `undefined` as "not recorded", never as "off". */
  recordSession: boolean | undefined;
  /** Where the adapters actually searched. `undefined` when no adapter
   *  resolved a point, and for every run written before this existed. */
  searchCenter: { lat: number; lng: number } | undefined;
}

export interface CreateJobInput {
  userId: string;
  location: LocationInput;
  requestText: string;
  requirements: PlannedRequirement[];
  intentIds: string[];
  searchLang: string;
  uiLocale: UiLocale;
  timeoutSec: number;
  /** Opt-in session recording. Omitted means off — the default the form ships. */
  recordSession?: boolean;
}

export type FinishJobStatus = Extract<JobStatus, "done" | "partial" | "error">;

function rowToJob(row: typeof jobs.$inferSelect): Job {
  return {
    id: row.id,
    userId: row.userId,
    status: JobStatusSchema.parse(row.status),
    location: parseJsonColumn(
      LocationSchema,
      row.locationJson,
      `job ${row.id} location_json`,
    ),
    requestText: row.requestText,
    requirements: parseJsonColumn(
      RequirementsJsonSchema,
      row.requirementsJson,
      `job ${row.id} requirements_json`,
    ),
    intentIds: parseJsonColumn(
      IntentIdsJsonSchema,
      row.intentIdsJson,
      `job ${row.id} intent_ids_json`,
    ),
    plannedRequirements:
      row.plannedRequirementsJson === null
        ? parseJsonColumn(
            RequirementsJsonSchema,
            row.requirementsJson,
            `job ${row.id} requirements_json`,
          )
        : parseJsonColumn(
            RequirementsJsonSchema,
            row.plannedRequirementsJson,
            `job ${row.id} planned_requirements_json`,
          ),
    plannedIntentIds:
      row.plannedIntentIdsJson === null
        ? parseJsonColumn(
            IntentIdsJsonSchema,
            row.intentIdsJson,
            `job ${row.id} intent_ids_json`,
          )
        : parseJsonColumn(
            IntentIdsJsonSchema,
            row.plannedIntentIdsJson,
            `job ${row.id} planned_intent_ids_json`,
          ),
    searchLang: row.searchLang,
    uiLocale: UiLocaleSchema.parse(row.uiLocale),
    timeoutSec: row.timeoutSec,
    errorText: row.errorText,
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    recordSession:
      row.recordSession === null ? undefined : row.recordSession === 1,
    sourceModes:
      row.sourceModesJson === null
        ? undefined
        : parseJsonColumn(
            SourceModesJsonSchema,
            row.sourceModesJson,
            `job ${row.id} source_modes_json`,
          ),
    searchCenter:
      row.searchLat === null || row.searchLng === null
        ? undefined
        : { lat: row.searchLat, lng: row.searchLng },
  };
}

/** Insert a new job in `queued` status. */
export async function createJob(
  db: DbHandle,
  input: CreateJobInput,
): Promise<Job> {
  const location = LocationSchema.parse(input.location);
  const requirements = RequirementsJsonSchema.parse(input.requirements);
  const intentIds = IntentIdsJsonSchema.parse(input.intentIds);
  const now = Date.now();

  const inserted = await db
    .insert(jobs)
    .values({
      id: randomUUID(),
      userId: input.userId,
      status: "queued",
      locationJson: JSON.stringify(location),
      requestText: input.requestText,
      requirementsJson: JSON.stringify(requirements),
      intentIdsJson: JSON.stringify(intentIds),
      searchLang: input.searchLang,
      uiLocale: UiLocaleSchema.parse(input.uiLocale),
      timeoutSec: input.timeoutSec,
      errorText: null,
      createdAt: now,
      startedAt: null,
      finishedAt: null,
      sourceModesJson: null,
      recordSession: input.recordSession === true ? 1 : 0,
    })
    .returning();

  const row = inserted[0];
  if (!row) throw new Error("createJob: insert returned no row");
  return rowToJob(row);
}

/**
 * Fetch a job by id WITHOUT an ownership filter. Worker-only: the background
 * runner is trusted and acts on jobs regardless of owner. Web/API code must use
 * `getJob` (which enforces the `userId` boundary) instead.
 */
export async function getJobById(
  db: DbHandle,
  jobId: string,
): Promise<Job | undefined> {
  const rows = await db
    .select()
    .from(jobs)
    .where(eq(jobs.id, jobId))
    .limit(1);
  const row = rows[0];
  return row ? rowToJob(row) : undefined;
}

/**
 * Queued jobs, oldest first — the worker poll loop's claim query. `rowid` breaks
 * ties for same-millisecond inserts so the order is deterministic.
 */
export async function listQueuedJobs(
  db: DbHandle,
  limit = 10,
): Promise<Job[]> {
  const rows = await db
    .select()
    .from(jobs)
    .where(eq(jobs.status, "queued"))
    .orderBy(asc(jobs.createdAt), asc(sql`rowid`))
    .limit(limit);
  return rows.map(rowToJob);
}

/**
 * Jobs still marked `running`.
 *
 * A job goes `running` in the worker process that claimed it, and only that
 * process can move it off. So if the process dies mid-run — a crash, a deploy,
 * or `tsx watch` restarting on a source edit — the row stays `running` forever:
 * the poll loop only ever claims `queued`, and no timeout applies because the
 * `JobBudget` that would have fired died with the process. The run page then
 * shows a spinner that never resolves.
 *
 * Callers use this at STARTUP to finalise those rows. That is only sound
 * because Sensitiv runs exactly one worker (see CLAUDE.md): a freshly started
 * process owns no running job by definition, so anything it finds here is
 * abandoned. A second concurrent worker would wrongly reap the first's work.
 */
export async function listRunningJobs(db: DbHandle, limit = 50): Promise<Job[]> {
  const rows = await db
    .select()
    .from(jobs)
    .where(eq(jobs.status, "running"))
    .orderBy(asc(jobs.createdAt), asc(sql`rowid`))
    .limit(limit);
  return rows.map(rowToJob);
}

/**
 * Fetch a job. `userId` is a REQUIRED filter — this is the auth boundary. A job
 * owned by another user resolves to `undefined`, exactly like a missing job.
 */
export async function getJob(
  db: DbHandle,
  jobId: string,
  userId: string,
): Promise<Job | undefined> {
  const rows = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.id, jobId), eq(jobs.userId, userId)))
    .limit(1);
  const row = rows[0];
  return row ? rowToJob(row) : undefined;
}

export async function listJobsForUser(
  db: DbHandle,
  userId: string,
  limit = 50,
): Promise<Job[]> {
  const rows = await db
    .select()
    .from(jobs)
    .where(eq(jobs.userId, userId))
    // createdAt is the spec order; rowid breaks ties for same-millisecond inserts.
    .orderBy(desc(jobs.createdAt), desc(sql`rowid`))
    .limit(limit);
  return rows.map(rowToJob);
}

/**
 * Wall-clock durations (ms) of this user's most recent FINISHED runs, newest
 * first — the sample the run page's ETA is a median of.
 *
 * `error` runs are excluded: a run that dies in the first second is not
 * evidence about how long a working run takes. `partial` runs are kept even
 * though they all land near the timeout — they are genuine full-length runs,
 * and dropping them would bias the estimate low for exactly the users whose
 * runs are slow. Scoped by `user_id` like every other job read.
 */
export async function recentRunDurationsForUser(
  db: DbHandle,
  userId: string,
  limit = 20,
): Promise<number[]> {
  const rows = await db
    .select({ startedAt: jobs.startedAt, finishedAt: jobs.finishedAt })
    .from(jobs)
    .where(
      and(
        eq(jobs.userId, userId),
        inArray(jobs.status, ["done", "partial"]),
        isNotNull(jobs.startedAt),
        isNotNull(jobs.finishedAt),
      ),
    )
    .orderBy(desc(jobs.finishedAt))
    .limit(limit);

  return rows
    .map((row) => (row.finishedAt ?? 0) - (row.startedAt ?? 0))
    // A clock adjustment mid-run can produce a negative or absurd span; those
    // are noise, not data.
    .filter((ms) => ms > 0 && Number.isFinite(ms));
}

/** Worker-side lifecycle: mark a queued job as running. */
export async function markJobRunning(db: DbHandle, jobId: string): Promise<void> {
  await db
    .update(jobs)
    .set({ status: "running", startedAt: Date.now() })
    .where(eq(jobs.id, jobId));
}

/**
 * Worker-side: record which sources actually ran live vs. fixture for this
 * job. Called before `finishJob` on every terminal path (done, partial, and
 * the timeout/error branches) — best-effort, a failure here must not fail
 * the job.
 */
export async function setJobSourceModes(
  db: DbHandle,
  jobId: string,
  modes: Record<string, SourceMode>,
): Promise<void> {
  await db
    .update(jobs)
    .set({ sourceModesJson: JSON.stringify(SourceModesJsonSchema.parse(modes)) })
    .where(eq(jobs.id, jobId));
}

/**
 * Record where the run actually searched.
 *
 * The centre, not per-place distances: a distance discards the point it was
 * measured from, and keeping the point lets the same dossier be re-measured
 * from somewhere else later without re-running the search.
 */
export async function setJobSearchCenter(
  db: DbHandle,
  jobId: string,
  center: { lat: number; lng: number },
): Promise<void> {
  await db
    .update(jobs)
    .set({ searchLat: center.lat, searchLng: center.lng })
    .where(eq(jobs.id, jobId));
}

/**
 * Record what the planner decided, as soon as it decides it.
 *
 * Deliberately a SECOND pair of columns rather than an overwrite of
 * `requirements_json`: "what the user asked for" and "what we chose to research"
 * are different facts, and a run has to be able to state both. Overwriting
 * would also feed the planner's own output back in as chips on a re-run.
 *
 * Until this existed the planner's output survived only inside each place's
 * frozen `score_breakdown_json`, so nothing on the read path could re-derive a
 * score or even work out what the best possible one would have been.
 */
export async function setJobPlan(
  db: DbHandle,
  jobId: string,
  plan: { requirements: PlannedRequirement[]; intentIds: string[] },
): Promise<void> {
  const requirements = RequirementsJsonSchema.parse(plan.requirements);
  const intentIds = IntentIdsJsonSchema.parse(plan.intentIds);
  await db
    .update(jobs)
    .set({
      plannedRequirementsJson: JSON.stringify(requirements),
      plannedIntentIdsJson: JSON.stringify(intentIds),
    })
    .where(eq(jobs.id, jobId));
}

/** Worker-side lifecycle: terminal state + finish timestamp. */
export async function finishJob(
  db: DbHandle,
  jobId: string,
  status: FinishJobStatus,
  errorText?: string,
): Promise<void> {
  await db
    .update(jobs)
    .set({
      status,
      finishedAt: Date.now(),
      errorText: errorText ?? null,
    })
    .where(eq(jobs.id, jobId));
}

/**
 * What deleting a run left behind for the caller to finish.
 *
 * The rows go here; the BYTES do not. `data/replays/` is a filesystem contract
 * this package deliberately does not act on — it owns SQLite and nothing else
 * (see the header of `schema.ts`) — so the stored paths come back and the
 * route that asked for the delete unlinks them through
 * `resolveStoredReplayPath`, the same containment check the worker's retention
 * sweep uses.
 */
export interface DeletedJob {
  /** Repo-relative `replays.stored_path` values whose files still exist. */
  storedReplayPaths: string[];
}

/**
 * Delete one run and everything the run produced.
 *
 * `userId` is a REQUIRED filter and the delete is scoped by it end to end: a
 * job owned by someone else resolves to `undefined`, exactly like a missing
 * one, and no row is touched. Every child table is reached through THIS job's
 * id — never through a list the caller supplied — so the boundary the
 * ownership check established cannot widen on the way down.
 *
 * `extraction_cache` is deliberately untouched. It is the one table with no
 * `user_id` and it holds what a public listing said about a place, keyed by a
 * one-way hash — nothing in it records that this user searched, or what for.
 * Clearing it on a delete would also mean a re-run pays the model again for
 * pages it has already read, which is the opposite of why it exists. Its rows
 * expire on their own (`EXTRACTION_CACHE_TTL_HOURS`).
 *
 * Children are removed before parents because `PRAGMA foreign_keys` is ON,
 * and the six deletes go out as one `db.batch`, which libsql runs as a single
 * transaction. NOT `db.transaction`: drizzle's libsql driver opens a fresh
 * CONNECTION for one, and a fresh connection to `:memory:` is a fresh, empty
 * database — every test in this package would silently lose its schema
 * mid-delete. `batch` stays on the connection it was given.
 *
 * Which is also why the child deletes select their rows with a subquery
 * rather than a list of ids read beforehand: a statement list has to be
 * complete before any of it runs, and a subquery keeps the whole thing one
 * atomic unit instead of a read followed by a delete that could disagree.
 */
export async function deleteJobForUser(
  db: DbHandle,
  jobId: string,
  userId: string,
): Promise<DeletedJob | undefined> {
  const owned = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.id, jobId), eq(jobs.userId, userId)))
    .limit(1);
  if (owned.length === 0) return undefined;

  // Read before the batch, because the caller needs these paths back and a
  // batch returns only what its own statements return. Worst case a replay
  // row is written between here and the delete: the row still goes, and one
  // orphaned file stays on disk rather than the delete failing.
  const replayRows = await db
    .select({ storedPath: replays.storedPath })
    .from(replays)
    .where(eq(replays.jobId, jobId));

  const placeIdsForJob = db
    .select({ id: places.id })
    .from(places)
    .where(eq(places.jobId, jobId));

  await db.batch([
    db.delete(evidence).where(inArray(evidence.placeId, placeIdsForJob)),
    db.delete(placeSources).where(inArray(placeSources.placeId, placeIdsForJob)),
    db.delete(places).where(eq(places.jobId, jobId)),
    db.delete(replays).where(eq(replays.jobId, jobId)),
    db.delete(jobEvents).where(eq(jobEvents.jobId, jobId)),
    db.delete(jobs).where(eq(jobs.id, jobId)),
  ]);

  return {
    storedReplayPaths: replayRows.flatMap((row) =>
      row.storedPath ? [row.storedPath] : [],
    ),
  };
}
