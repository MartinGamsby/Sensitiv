import { afterEach, describe, expect, it } from "vitest";
import type { Database } from "./client.ts";
import { appendEvent, listEventsAfter } from "./events.ts";
import { createJob } from "./jobs.ts";
import { getOrCreateLocalUser } from "./users.ts";
import { makeTestDb } from "../test/helpers.ts";
import { sampleJobInput } from "../test/fixtures.ts";

let handle: Database | undefined;
afterEach(() => {
  handle?.client.close();
  handle = undefined;
});

describe("job events", () => {
  it("appendEvent x5 then listEventsAfter(2) returns events 3-5 ascending", async () => {
    handle = await makeTestDb();
    const user = await getOrCreateLocalUser(handle.db);
    const job = await createJob(handle.db, sampleJobInput(user.id));

    const ids: number[] = [];
    for (let i = 1; i <= 5; i++) {
      const ev = await appendEvent(handle.db, job.id, "info", `step ${i}`);
      ids.push(ev.id);
    }
    expect(ids).toEqual([...ids].sort((a, b) => a - b));

    const tail = await listEventsAfter(handle.db, job.id, ids[1] as number);
    expect(tail.map((e) => e.message)).toEqual(["step 3", "step 4", "step 5"]);
    expect(tail.map((e) => e.id)).toEqual([...tail.map((e) => e.id)].sort((a, b) => a - b));
    // ts serializes as an ISO string per the shared JobEvent schema.
    expect(() => new Date(tail[0]!.ts).toISOString()).not.toThrow();
  });

  it("scopes events to the given job", async () => {
    handle = await makeTestDb();
    const user = await getOrCreateLocalUser(handle.db);
    const jobA = await createJob(handle.db, sampleJobInput(user.id));
    const jobB = await createJob(handle.db, sampleJobInput(user.id));
    await appendEvent(handle.db, jobA.id, "info", "a");
    await appendEvent(handle.db, jobB.id, "warn", "b", "worker");
    const eventsB = await listEventsAfter(handle.db, jobB.id, 0);
    expect(eventsB).toHaveLength(1);
    expect(eventsB[0]?.source).toBe("worker");
  });
});
