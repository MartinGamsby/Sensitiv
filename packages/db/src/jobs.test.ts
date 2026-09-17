import { afterEach, describe, expect, it } from "vitest";
import type { Database } from "./client.ts";
import {
  createJob,
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
