import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addReplay,
  createJob,
  finishJob,
  getJob,
  getOrCreateLocalUser,
  markJobRunning,
  schema,
  type Database,
} from "@sensitiv/db";
import { __setWebDeps } from "../../../../server/deps.ts";
import { makeTestDb } from "../../../../test-support/db.ts";
import { testEnv } from "../../../../test-support/env.ts";
import { DELETE, GET } from "./route.ts";

let handle: Database;
let logSpies: Array<ReturnType<typeof vi.spyOn>>;

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

function req(): Request {
  return new Request("http://localhost/api/jobs/x", { method: "DELETE" });
}

async function makeJob(userId: string): Promise<string> {
  const job = await createJob(handle.db, {
    userId,
    location: { query: "Plateau-Mont-Royal, Montreal" },
    requestText: "gluten free brunch",
    requirements: [],
    intentIds: [],
    searchLang: "fr",
    uiLocale: "en",
    timeoutSec: 480,
  });
  return job.id;
}

beforeEach(async () => {
  handle = await makeTestDb();
  __setWebDeps({ db: handle.db, env: testEnv() });
  logSpies = (["info", "warn", "error"] as const).map((level) =>
    vi.spyOn(console, level).mockImplementation(() => {}),
  );
});

afterEach(() => {
  __setWebDeps(undefined);
  for (const spy of logSpies) spy.mockRestore();
  handle.client.close();
});

describe("DELETE /api/jobs/:id", () => {
  it("forgets a finished run", async () => {
    const user = await getOrCreateLocalUser(handle.db);
    const id = await makeJob(user.id);
    await finishJob(handle.db, id, "done");

    const res = await DELETE(req(), ctx(id));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: true });
    expect(await getJob(handle.db, id, user.id)).toBeUndefined();
    // And the dossier read is gone with it, not just hidden from the list.
    expect((await GET(new Request("http://localhost/x"), ctx(id))).status).toBe(404);
  });

  it("404s for a job that belongs to someone else, without touching it", async () => {
    // The same answer a missing job gets — existence is never confirmed.
    const other = randomUUID();
    await handle.db.insert(schema.users).values({
      id: other,
      email: `${other}@example.test`,
      uiLocale: "en",
      defaultTimeoutSec: 480,
      createdAt: Date.now(),
    });
    const id = await makeJob(other);
    await finishJob(handle.db, id, "done");

    const res = await DELETE(req(), ctx(id));

    expect(res.status).toBe(404);
    expect(await getJob(handle.db, id, other)).toBeDefined();
  });

  it("404s for an id that was never a job", async () => {
    expect((await DELETE(req(), ctx(randomUUID()))).status).toBe(404);
  });

  it("refuses a run that is still going, and leaves it running", async () => {
    // The worker is still appending `job_events` rows against this id with
    // foreign keys ON, so deleting the row would crash the run rather than
    // cancel it. Cancellation is a separate feature.
    const user = await getOrCreateLocalUser(handle.db);
    const id = await makeJob(user.id);
    await markJobRunning(handle.db, id);

    const res = await DELETE(req(), ctx(id));

    expect(res.status).toBe(409);
    expect(await getJob(handle.db, id, user.id)).toBeDefined();
  });

  it("refuses a run that has not started either", async () => {
    const user = await getOrCreateLocalUser(handle.db);
    const id = await makeJob(user.id);

    expect((await DELETE(req(), ctx(id))).status).toBe(409);
  });

  it("does not fail when a recorded replay's file is already gone", async () => {
    // `stored_path` points at `data/replays/…`, which nothing wrote in a
    // test. A missing file is not a reason to keep the rows.
    const user = await getOrCreateLocalUser(handle.db);
    const id = await makeJob(user.id);
    await addReplay(handle.db, id, {
      solariSessionId: "sess-1",
      status: "stored",
      storedPath: `data/replays/${id}/sess-1.ndjson.gz`,
    });
    await finishJob(handle.db, id, "done");

    expect((await DELETE(req(), ctx(id))).status).toBe(200);
    expect(await getJob(handle.db, id, user.id)).toBeUndefined();
  });
});
