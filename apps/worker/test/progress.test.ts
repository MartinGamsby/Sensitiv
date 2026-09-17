// The run page's progress bar reads `job_events.progress`, never the wording of
// a message. That only holds if `runJob` actually tags rows — so this walks a
// real run (empty `.env`: fake LLM + fixture browsers) and asserts the markers
// that come out of it.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listEventsAfter } from "@sensitiv/db";
import {
  RUN_PHASES,
  progressFraction,
  type JobProgress,
  type RunPhase,
} from "@sensitiv/shared";
import { runJob } from "../src/runner.ts";
import { makeDb, seedJob, type TestDb } from "./helpers.ts";

let handle: TestDb | undefined;

beforeEach(async () => {
  handle = await makeDb();
});

afterEach(() => {
  handle?.client.close();
  handle = undefined;
});

/** Every progress marker a completed run left behind, in order. */
async function markersOf(db: TestDb, jobId: string): Promise<JobProgress[]> {
  const events = await listEventsAfter(db.db, jobId, 0, 1_000);
  return events.flatMap((e) => (e.progress ? [e.progress] : []));
}

describe("runJob progress markers", () => {
  it("emits every phase, in order, exactly once per phase entry", async () => {
    const db = handle!;
    const job = await seedJob(db.db);
    await runJob(db.db, job.id, { logSink: () => undefined });

    const phases = (await markersOf(db, job.id)).map((m) => m.phase);
    // Every phase the UI numbers must actually occur, or "step 4 of 5" is a lie.
    for (const phase of RUN_PHASES) expect(phases).toContain(phase);

    // First occurrences must follow the declared order.
    const firstSeen = RUN_PHASES.map((p: RunPhase) => phases.indexOf(p));
    expect(firstSeen).toEqual([...firstSeen].sort((a, b) => a - b));
  });

  it("never moves the bar backwards over the life of a run", async () => {
    const db = handle!;
    const job = await seedJob(db.db);
    await runJob(db.db, job.id, { logSink: () => undefined });

    const fractions = (await markersOf(db, job.id)).map(progressFraction);
    expect(fractions.length).toBeGreaterThan(1);
    for (let i = 1; i < fractions.length; i++) {
      expect(fractions[i]!).toBeGreaterThanOrEqual(fractions[i - 1]!);
    }
  });

  it("counts the sources phase, and reaches its own total", async () => {
    const db = handle!;
    const job = await seedJob(db.db);
    await runJob(db.db, job.id, { logSink: () => undefined });

    const sources = (await markersOf(db, job.id)).filter(
      (m) => m.phase === "sources",
    );
    const total = sources[0]?.total ?? 0;
    expect(total).toBeGreaterThan(0);
    // Opens at 0 and closes at `total`: every adapter is accounted for, so the
    // bar cannot stall part-way through the phase that dominates a run.
    expect(sources[0]?.done).toBe(0);
    expect(sources.at(-1)?.done).toBe(total);
    // All of them agree on how many sources there are.
    for (const m of sources) expect(m.total).toBe(total);
  });

  it("leaves ordinary log rows untagged", async () => {
    const db = handle!;
    const job = await seedJob(db.db);
    await runJob(db.db, job.id, { logSink: () => undefined });

    const events = await listEventsAfter(db.db, job.id, 0, 1_000);
    const tagged = events.filter((e) => e.progress);
    // The markers are a handful of deliberate rows, not a field on every line.
    expect(tagged.length).toBeLessThan(events.length);
  });
});
