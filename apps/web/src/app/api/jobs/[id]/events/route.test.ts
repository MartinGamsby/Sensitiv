import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendEvent,
  createJob,
  finishJob,
  getOrCreateLocalUser,
  type Database,
} from "@sensitiv/db";
import { __setWebDeps } from "../../../../../server/deps.ts";
import { makeTestDb } from "../../../../../test-support/db.ts";
import { testEnv } from "../../../../../test-support/env.ts";
import { GET, __setSseTimings } from "./route.ts";

let handle: Database;

function ctx(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

function sseReq(id: string, query = ""): Request {
  return new Request(`http://localhost/api/jobs/${id}/events${query}`);
}

async function seedJob(): Promise<string> {
  const user = await getOrCreateLocalUser(handle.db);
  const job = await createJob(handle.db, {
    userId: user.id,
    location: { query: "Montreal" },
    requestText: "test",
    requirements: [
      { id: "celiac", label: "Celiac", intentIds: ["dining"], must: [], nice: [] },
    ],
    intentIds: ["dining"],
    searchLang: "en",
    uiLocale: "en",
    timeoutSec: 480,
  });
  return job.id;
}

async function readAll(
  body: ReadableStream<Uint8Array>,
  timeoutMs = 3_000,
): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const deadline = Date.now() + timeoutMs;
  let text = "";
  while (Date.now() < deadline) {
    const chunk = await Promise.race([
      reader.read(),
      new Promise<{ done: true; value: undefined }>((resolve) =>
        setTimeout(
          () => resolve({ done: true, value: undefined }),
          Math.max(0, deadline - Date.now()),
        ),
      ),
    ]);
    if (chunk.done) break;
    if (chunk.value) text += decoder.decode(chunk.value, { stream: true });
  }
  try {
    await reader.cancel();
  } catch {
    // ignore
  }
  return text;
}

beforeEach(async () => {
  handle = await makeTestDb();
  __setWebDeps({ db: handle.db, env: testEnv(), fetch: globalThis.fetch });
  __setSseTimings({ pollMs: 10, heartbeatMs: 60_000 });
});

afterEach(() => {
  __setWebDeps(undefined);
  __setSseTimings(undefined);
  handle.client.close();
});

describe("GET /api/jobs/:id/events", () => {
  it("returns 404 for an unknown / unowned job without confirming existence", async () => {
    const res = await GET(sseReq("does-not-exist"), ctx("does-not-exist"));
    expect(res.status).toBe(404);
  });

  it("streams only events after the cursor, then a job-status frame on terminal", async () => {
    const id = await seedJob();
    await appendEvent(handle.db, id, "info", "event one");
    const e2 = await appendEvent(handle.db, id, "info", "event two");
    const e3 = await appendEvent(handle.db, id, "warn", "event three");

    const res = await GET(sseReq(id, "?after=1"), ctx(id));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(res.headers.get("cache-control")).toContain("no-cache");
    expect(res.headers.get("x-accel-buffering")).toBe("no");

    // Flip the job to terminal shortly after the stream opens.
    setTimeout(() => {
      void finishJob(handle.db, id, "done");
    }, 40);

    const text = await readAll(res.body!);

    expect(text).toContain(`id: ${e2.id}`);
    expect(text).toContain(`id: ${e3.id}`);
    expect(text).toContain("event two");
    expect(text).toContain("event three");
    expect(text).not.toContain("event one");

    // Immediate status frame on connect + terminal status frame at the end.
    expect(text).toContain("event: job-status");
    expect(text).toContain('"status":"done"');
  });

  it("emits an immediate job-status frame so the UI is never blank", async () => {
    const id = await seedJob();
    setTimeout(() => {
      void finishJob(handle.db, id, "error");
    }, 20);
    const res = await GET(sseReq(id), ctx(id));
    const text = await readAll(res.body!);
    expect(text).toMatch(/event: job-status\ndata: \{"status":"queued"\}/);
    expect(text).toContain('"status":"error"');
  });
});
