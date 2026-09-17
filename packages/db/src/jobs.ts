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
import { jobs } from "./schema.ts";

const RequirementsJsonSchema = z.array(PlannedRequirementSchema);
const IntentIdsJsonSchema = z.array(z.string());
const SourceModesJsonSchema = z.record(SourceModeSchema);

export interface Job {
  id: string;
  userId: string;
  status: JobStatus;
  location: Location;
  requestText: string;
  requirements: PlannedRequirement[];
  intentIds: string[];
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
    searchLang: row.searchLang,
    uiLocale: UiLocaleSchema.parse(row.uiLocale),
    timeoutSec: row.timeoutSec,
    errorText: row.errorText,
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    sourceModes:
      row.sourceModesJson === null
        ? undefined
        : parseJsonColumn(
            SourceModesJsonSchema,
            row.sourceModesJson,
            `job ${row.id} source_modes_json`,
          ),
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
