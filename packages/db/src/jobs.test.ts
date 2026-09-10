import { afterEach, describe, expect, it } from "vitest";
import type { Database } from "./client.ts";
import {
  createJob,
  finishJob,
  getJob,
  listJobsForUser,
  markJobRunning,
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
