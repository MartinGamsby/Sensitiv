import { and, asc, eq, gt } from "drizzle-orm";
import {
  JobEventSchema,
  JobProgressSchema,
  type JobEvent,
  type JobProgress,
} from "@sensitiv/shared";
import type { DbHandle } from "./client.ts";
import { jobEvents } from "./schema.ts";

export type JobEventLevel = JobEvent["level"];

/**
 * A NULL or unparseable `progress_json` is "this row says nothing about
 * progress" — dropped, never surfaced as a zeroed marker, which would drag the
 * run page's bar backwards. Rows written before the column existed all read
 * NULL here.
 */
function rowToProgress(raw: string | null): JobProgress | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JobProgressSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

function rowToEvent(row: typeof jobEvents.$inferSelect): JobEvent {
  return JobEventSchema.parse({
    id: row.id,
    jobId: row.jobId,
    ts: new Date(row.ts).toISOString(),
    level: row.level,
    message: row.message,
    source: row.source ?? undefined,
    progress: rowToProgress(row.progressJson),
  });
}

/** Append one log line for a job. The returned `id` is the SSE cursor. */
export async function appendEvent(
  db: DbHandle,
  jobId: string,
  level: JobEventLevel,
  message: string,
  source?: string,
  progress?: JobProgress,
): Promise<JobEvent> {
  const inserted = await db
    .insert(jobEvents)
    .values({
      jobId,
      ts: Date.now(),
      level,
      message,
      source: source ?? null,
      progressJson: progress
        ? JSON.stringify(JobProgressSchema.parse(progress))
        : null,
    })
    .returning();
  const row = inserted[0];
  if (!row) throw new Error("appendEvent: insert returned no row");
  return rowToEvent(row);
}

/**
 * Events for a job with `id > afterId`, ascending by id — the SSE tail. Pass
 * `afterId = 0` for the whole log.
 */
export async function listEventsAfter(
  db: DbHandle,
  jobId: string,
  afterId: number,
  limit = 200,
): Promise<JobEvent[]> {
  const rows = await db
    .select()
    .from(jobEvents)
    .where(and(eq(jobEvents.jobId, jobId), gt(jobEvents.id, afterId)))
    .orderBy(asc(jobEvents.id))
    .limit(limit);
  return rows.map(rowToEvent);
}
