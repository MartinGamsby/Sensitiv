import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, sql } from "drizzle-orm";
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
