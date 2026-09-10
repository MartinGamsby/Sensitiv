import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
  JobStatusSchema,
  LocationSchema,
  PlannedRequirementSchema,
  UiLocaleSchema,
  type JobStatus,
  type Location,
  type LocationInput,
  type PlannedRequirement,
  type UiLocale,
} from "@sensitiv/shared";
import type { DbHandle } from "./client.ts";
import { parseJsonColumn } from "./json.ts";
import { jobs } from "./schema.ts";

const RequirementsJsonSchema = z.array(PlannedRequirementSchema);
const IntentIdsJsonSchema = z.array(z.string());

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
    })
    .returning();

  const row = inserted[0];
  if (!row) throw new Error("createJob: insert returned no row");
  return rowToJob(row);
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
