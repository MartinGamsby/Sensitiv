import { and, asc, eq, gt } from "drizzle-orm";
import { JobEventSchema, type JobEvent } from "@sensitiv/shared";
import type { DbHandle } from "./client.ts";
import { jobEvents } from "./schema.ts";

export type JobEventLevel = JobEvent["level"];

function rowToEvent(row: typeof jobEvents.$inferSelect): JobEvent {
  return JobEventSchema.parse({
    id: row.id,
    jobId: row.jobId,
    ts: new Date(row.ts).toISOString(),
    level: row.level,
    message: row.message,
    source: row.source ?? undefined,
  });
}

/** Append one log line for a job. The returned `id` is the SSE cursor. */
export async function appendEvent(
  db: DbHandle,
  jobId: string,
  level: JobEventLevel,
  message: string,
  source?: string,
): Promise<JobEvent> {
  const inserted = await db
    .insert(jobEvents)
    .values({
      jobId,
      ts: Date.now(),
      level,
      message,
      source: source ?? null,
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
