import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import type { Database } from "./client.ts";
import {
  createJob,
  deleteJobForUser,
  finishJob,
  getJob,
  getJobById,
  listJobsForUser,
  listQueuedJobs,
  markJobRunning,
  recentRunDurationsForUser,
  setJobSourceModes,
} from "./jobs.ts";
import { getOrCreateLocalUser } from "./users.ts";
import { appendEvent } from "./events.ts";
import {
  addEvidence,
  addPlaceSource,
  addReplay,
  upsertPlace,
} from "./results.ts";
import {
  evidence as evidenceTable,
  jobEvents,
  jobs as jobsTable,
  placeSources,
  places as placesTable,
  replays,
  users,
} from "./schema.ts";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import { getCachedExtractions, putCachedExtractions } from "./extraction-cache.ts";
import { makeTestDb } from "../test/helpers.ts";
import { sampleJobInput } from "../test/fixtures.ts";

let handle: Database | undefined;
afterEach(() => {
  handle?.client.close();
  handle = undefined;
});

describe("createJob / getJob", () => {
  it("round-trips location and requirements through Zod unchanged", async () => {
    handle = await makeTestDb();
    const user = await getOrCreateLocalUser(handle.db);
    const created = await createJob(handle.db, sampleJobInput(user.id));
    expect(created.status).toBe("queued");

    const fetched = await getJob(handle.db, created.id, user.id);
    expect(fetched).toBeDefined();
    expect(fetched?.location.query).toBe("Plateau-Mont-Royal, Montreal");
    expect(fetched?.location.country).toBe("CA");
    expect(fetched?.location.postalCode).toBe("H2T1A1");
    expect(fetched?.location.radiusKm).toBe(5);
    expect(fetched?.requirements).toHaveLength(1);
    expect(fetched?.requirements[0]?.id).toBe("req_celiac");
    expect(fetched?.requirements[0]?.allergens).toEqual(["gluten"]);
    expect(fetched?.intentIds).toEqual(["intent_dining"]);
    expect(fetched?.searchLang).toBe("fr");
    expect(fetched?.uiLocale).toBe("fr");
  });

  it("records session recording as opt-in: omitted means off, never NULL", async () => {
    // A NULL column reads as "not recorded" everywhere else in this schema, so
    // a fresh row must carry an explicit 0 rather than leaving the reader to
    // guess. Only a pre-existing row (written before the column) is `undefined`.
    handle = await makeTestDb();
    const user = await getOrCreateLocalUser(handle.db);

    const off = await createJob(handle.db, sampleJobInput(user.id));
    expect(off.recordSession).toBe(false);
    expect((await getJob(handle.db, off.id, user.id))?.recordSession).toBe(false);

    const on = await createJob(handle.db, {
      ...sampleJobInput(user.id),
      recordSession: true,
    });
    expect(on.recordSession).toBe(true);
    expect((await getJob(handle.db, on.id, user.id))?.recordSession).toBe(true);
  });

  it("getJob with another user's id returns undefined (ownership boundary)", async () => {
    handle = await makeTestDb();
    const user = await getOrCreateLocalUser(handle.db);
    const created = await createJob(handle.db, sampleJobInput(user.id));
    expect(await getJob(handle.db, created.id, "someone-else")).toBeUndefined();
  });
});

describe("lifecycle + listing", () => {
  it("markJobRunning then finishJob move status and stamps", async () => {
    handle = await makeTestDb();
    const user = await getOrCreateLocalUser(handle.db);
    const created = await createJob(handle.db, sampleJobInput(user.id));

    await markJobRunning(handle.db, created.id);
    let job = await getJob(handle.db, created.id, user.id);
    expect(job?.status).toBe("running");
    expect(job?.startedAt).toBeTypeOf("number");

    await finishJob(handle.db, created.id, "partial", "ran out of time");
    job = await getJob(handle.db, created.id, user.id);
    expect(job?.status).toBe("partial");
    expect(job?.errorText).toBe("ran out of time");
    expect(job?.finishedAt).toBeTypeOf("number");
  });

  it("getJobById ignores ownership; listQueuedJobs returns queued oldest-first", async () => {
    handle = await makeTestDb();
    const user = await getOrCreateLocalUser(handle.db);
    const a = await createJob(handle.db, sampleJobInput(user.id));
    const b = await createJob(handle.db, sampleJobInput(user.id));

    expect((await getJobById(handle.db, a.id))?.id).toBe(a.id);
    expect(await getJobById(handle.db, "missing")).toBeUndefined();

    let queued = await listQueuedJobs(handle.db);
    expect(queued.map((j) => j.id)).toEqual([a.id, b.id]);

    await markJobRunning(handle.db, a.id);
    queued = await listQueuedJobs(handle.db);
    expect(queued.map((j) => j.id)).toEqual([b.id]);
  });

  it("listJobsForUser returns newest first and only that user's jobs", async () => {
    handle = await makeTestDb();
    const user = await getOrCreateLocalUser(handle.db);
    const a = await createJob(handle.db, sampleJobInput(user.id));
    const b = await createJob(handle.db, sampleJobInput(user.id));
    const list = await listJobsForUser(handle.db, user.id);
    expect(list.map((j) => j.id).slice(0, 2)).toEqual([b.id, a.id]);
    expect(await listJobsForUser(handle.db, "other")).toEqual([]);
  });
});

describe("source modes provenance", () => {
  it("a freshly-created job has undefined sourceModes (NULL column)", async () => {
    handle = await makeTestDb();
    const user = await getOrCreateLocalUser(handle.db);
    const created = await createJob(handle.db, sampleJobInput(user.id));
    expect(created.sourceModes).toBeUndefined();

    const fetched = await getJob(handle.db, created.id, user.id);
    expect(fetched?.sourceModes).toBeUndefined();
  });

  it("setJobSourceModes round-trips through rowToJob", async () => {
    handle = await makeTestDb();
    const user = await getOrCreateLocalUser(handle.db);
    const created = await createJob(handle.db, sampleJobInput(user.id));

    await setJobSourceModes(handle.db, created.id, {
      llm: "fixture",
      google_maps: "live",
    });

    const fetched = await getJob(handle.db, created.id, user.id);
    expect(fetched?.sourceModes).toEqual({ llm: "fixture", google_maps: "live" });
  });

  it("does not throw on a NULL column and yields undefined, never a live guess", async () => {
    handle = await makeTestDb();
    const user = await getOrCreateLocalUser(handle.db);
    const created = await createJob(handle.db, sampleJobInput(user.id));
    // Never called setJobSourceModes — simulates every run from before this change.
    const fetched = await getJobById(handle.db, created.id);
    expect(fetched?.sourceModes).toBeUndefined();
  });
});

describe("recentRunDurationsForUser", () => {
  /** A job driven all the way to `status`, with a controlled wall-clock span. */
  async function runJobFor(
    db: Parameters<typeof createJob>[0],
    userId: string,
    status: "done" | "partial" | "error",
  ): Promise<string> {
    const job = await createJob(db, sampleJobInput(userId));
    await markJobRunning(db, job.id);
    // Both timestamps are `Date.now()`; without a real gap the run spans zero
    // milliseconds and is (correctly) filtered out as noise.
    await new Promise((resolve) => setTimeout(resolve, 5));
    await finishJob(db, job.id, status);
    return job.id;
  }

  it("reports a positive duration per finished run", async () => {
    handle = await makeTestDb();
    const user = await getOrCreateLocalUser(handle.db);
    await runJobFor(handle.db, user.id, "done");
    await runJobFor(handle.db, user.id, "partial");

    const durations = await recentRunDurationsForUser(handle.db, user.id);
    expect(durations).toHaveLength(2);
    for (const ms of durations) expect(ms).toBeGreaterThan(0);
  });

  it("excludes runs that errored — a run that died says nothing about pacing", async () => {
    handle = await makeTestDb();
    const user = await getOrCreateLocalUser(handle.db);
    await runJobFor(handle.db, user.id, "error");

    expect(await recentRunDurationsForUser(handle.db, user.id)).toEqual([]);
  });

  it("excludes runs that never started or never finished", async () => {
    handle = await makeTestDb();
    const user = await getOrCreateLocalUser(handle.db);
    // Queued: no started_at, no finished_at.
    await createJob(handle.db, sampleJobInput(user.id));
    // Running: started, not finished.
    const running = await createJob(handle.db, sampleJobInput(user.id));
    await markJobRunning(handle.db, running.id);

    expect(await recentRunDurationsForUser(handle.db, user.id)).toEqual([]);
  });

  it("stays inside the user_id boundary", async () => {
    handle = await makeTestDb();
    const user = await getOrCreateLocalUser(handle.db);
    await runJobFor(handle.db, user.id, "done");

    expect(await recentRunDurationsForUser(handle.db, "someone-else")).toEqual([]);
  });

  it("honours the limit, newest run first", async () => {
    handle = await makeTestDb();
    const user = await getOrCreateLocalUser(handle.db);
    for (let i = 0; i < 4; i++) await runJobFor(handle.db, user.id, "done");

    expect(await recentRunDurationsForUser(handle.db, user.id, 2)).toHaveLength(2);
  });
});

/** Every child table populated for one job, so a delete has something to miss. */
async function runWithEverything(
  handle: Database,
  userId: string,
): Promise<string> {
  const job = await createJob(handle.db, sampleJobInput(userId));
  await appendEvent(handle.db, job.id, "info", "started");
  const place = await upsertPlace(handle.db, job.id, {
    name: "Café Test",
    canonicalKey: "cafe-test",
  });
  await addPlaceSource(handle.db, place.id, {
    source: "google_maps",
    sourceUrl: "https://maps.example/x",
  });
  await addEvidence(handle.db, place.id, {
    requirementId: "req_celiac",
    claim: "dedicated kitchen",
    polarity: "supports",
    quote: "cuisine dédiée",
    source: "google_maps",
    sourceUrl: "https://maps.example/x",
    confidence: 0.9,
  });
  await addReplay(handle.db, job.id, {
    solariSessionId: "sess-1",
    adapterId: "google_maps",
    status: "stored",
    storedPath: `data/replays/${job.id}/sess-1.ndjson.gz`,
    sizeBytes: 10,
    contentType: "application/gzip",
  });
  await finishJob(handle.db, job.id, "done");
  return job.id;
}

async function countAll(handle: Database): Promise<Record<string, number>> {
  const rows = async (table: SQLiteTable): Promise<number> =>
    (await handle.db.select().from(table)).length;
  return {
    jobs: await rows(jobsTable),
    events: await rows(jobEvents),
    places: await rows(placesTable),
    placeSources: await rows(placeSources),
    evidence: await rows(evidenceTable),
    replays: await rows(replays),
  };
}

describe("deleteJobForUser", () => {
  it("takes the run and every row it produced with it", async () => {
    handle = await makeTestDb();
    const user = await getOrCreateLocalUser(handle.db);
    const jobId = await runWithEverything(handle, user.id);

    expect(await countAll(handle)).toEqual({
      jobs: 1,
      events: 1,
      places: 1,
      placeSources: 1,
      evidence: 1,
      replays: 1,
    });

    const result = await deleteJobForUser(handle.db, jobId, user.id);

    expect(result?.storedReplayPaths).toEqual([
      `data/replays/${jobId}/sess-1.ndjson.gz`,
    ]);
    expect(await countAll(handle)).toEqual({
      jobs: 0,
      events: 0,
      places: 0,
      placeSources: 0,
      evidence: 0,
      replays: 0,
    });
  });

  it("leaves the extraction cache alone", async () => {
    // The user asked to forget a RUN, not to throw away pages the model has
    // already been paid to read. The cache holds public listing content keyed
    // by a one-way hash, with no record of who searched or what for, and it
    // expires on its own.
    handle = await makeTestDb();
    const user = await getOrCreateLocalUser(handle.db);
    const jobId = await runWithEverything(handle, user.id);
    await putCachedExtractions(
      handle.db,
      "google_maps",
      [{ key: "key-1", findingsJson: "[]" }],
      24,
    );

    await deleteJobForUser(handle.db, jobId, user.id);

    expect((await getCachedExtractions(handle.db, ["key-1"])).size).toBe(1);
  });

  it("will not delete another user's run, and leaves it untouched", async () => {
    handle = await makeTestDb();
    const user = await getOrCreateLocalUser(handle.db);
    const other = randomUUID();
    await handle.db.insert(users).values({
      id: other,
      email: `${other}@example.test`,
      uiLocale: "en",
      defaultTimeoutSec: 480,
      createdAt: Date.now(),
    });
    const jobId = await runWithEverything(handle, user.id);

    // Same 404-shaped answer as `getJob`: indistinguishable from missing.
    expect(await deleteJobForUser(handle.db, jobId, other)).toBeUndefined();
    expect((await countAll(handle)).jobs).toBe(1);
    expect(await getJob(handle.db, jobId, user.id)).toBeDefined();
  });

  it("reports no stored paths for a run that recorded nothing", async () => {
    handle = await makeTestDb();
    const user = await getOrCreateLocalUser(handle.db);
    const job = await createJob(handle.db, sampleJobInput(user.id));
    await finishJob(handle.db, job.id, "done");

    expect(await deleteJobForUser(handle.db, job.id, user.id)).toEqual({
      storedReplayPaths: [],
    });
  });
});
