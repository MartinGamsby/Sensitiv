import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { finishJob } from "@sensitiv/db";
import { loadEnv } from "@sensitiv/shared/env";
import { startServer, type WorkerServer } from "./server.ts";
import { makeDb, seedJob, type TestDb } from "../test/helpers.ts";

let server: WorkerServer | undefined;
let handle: TestDb | undefined;

beforeEach(async () => {
  handle = await makeDb();
});
afterEach(async () => {
  await server?.close();
  server = undefined;
  handle?.client.close();
  handle = undefined;
  vi.restoreAllMocks();
});

async function statusOf(jobId: string): Promise<{ status: string; errorText: string | null }> {
  const rows = await handle!.client.execute({
    sql: "SELECT status, error_text FROM jobs WHERE id = ?",
    args: [jobId],
  });
  const row = rows.rows[0];
  return {
    status: String(row?.status),
    errorText: row?.error_text == null ? null : String(row.error_text),
  };
}

async function waitFor(
  check: () => Promise<boolean>,
  timeoutMs = 5_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await new Promise((r) => setTimeout(r, 20));
  }
  return false;
}

describe("worker HTTP surface", () => {
  it("GET /healthz reports booleans, never key values", async () => {
    server = await startServer({ port: 0, db: handle!.db, env: loadEnv({}) });
    const res = await fetch(`${server.url}/healthz`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      solari: boolean;
      llm: string;
    };
    expect(body.ok).toBe(true);
    expect(typeof body.solari).toBe("boolean");
    expect(["anthropic", "fake"]).toContain(body.llm);
  });

  it("POST /jobs answers 202 immediately and runs the job in the background", async () => {
    const job = await seedJob(handle!.db);
    server = await startServer({ port: 0, db: handle!.db, env: loadEnv({}) });

    const res = await fetch(`${server.url}/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jobId: job.id }),
    });
    expect(res.status).toBe(202);
    expect((await res.json()) as { jobId: string }).toMatchObject({
      jobId: job.id,
    });

    const deadline = Date.now() + 5_000;
    let status = "queued";
    while (Date.now() < deadline) {
      const row = await handle!.client.execute({
        sql: "SELECT status FROM jobs WHERE id = ?",
        args: [job.id],
      });
      status = String(row.rows[0]?.status);
      if (status === "done" || status === "partial") break;
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(["done", "partial"]).toContain(status);
  });

  it("POST /jobs refuses a request carrying an Origin header", async () => {
    const job = await seedJob(handle!.db);
    server = await startServer({ port: 0, db: handle!.db, env: loadEnv({}) });

    // What a malicious page the user has open would send: a "simple" request
    // (text/plain -> no preflight) that `JSON.parse` would otherwise accept.
    const res = await fetch(`${server.url}/jobs`, {
      method: "POST",
      headers: { "content-type": "text/plain", origin: "https://evil.example" },
      body: JSON.stringify({ jobId: job.id }),
    });
    expect(res.status).toBe(403);
    expect((await statusOf(job.id)).status).toBe("queued");
  });

  it("POST /jobs rejects a body with no jobId", async () => {
    server = await startServer({ port: 0, db: handle!.db, env: loadEnv({}) });
    const res = await fetch(`${server.url}/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});

describe("worker poll loop", () => {
  const SOLARI_SECRET = "solari-live-key-do-not-log";

  it("a job whose run throws before it can be marked ends as `error`, is never re-claimed, and the loop keeps polling", async () => {
    const doomed = await seedJob(handle!.db);
    const claims: string[] = [];
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    server = await startServer({
      port: 0,
      db: handle!.db,
      poll: true,
      pollIntervalMs: 10,
      env: loadEnv({ SOLARI_API_KEY: SOLARI_SECRET }),
      // Throws immediately — i.e. before `markJobRunning`, like a bad
      // LLM_PROVIDER or a deleted row would. The row is still `queued`.
      runJob: async (_db, jobId) => {
        claims.push(jobId);
        if (jobId === doomed.id) {
          throw new Error(`boom while authenticating with ${SOLARI_SECRET}`);
        }
        await finishJob(handle!.db, jobId, "done");
        return { status: "done", placeCount: 0, evidenceCount: 0, events: 0 };
      },
    });

    // 1. it reaches a terminal state instead of sitting at `queued`
    expect(
      await waitFor(async () => (await statusOf(doomed.id)).status === "error"),
    ).toBe(true);

    // 2. the error text is persisted and scrubbed of the key
    const row = await statusOf(doomed.id);
    expect(row.errorText).toContain("boom");
    expect(row.errorText).not.toContain(SOLARI_SECRET);
    expect(row.errorText).toContain("***");

    // 3. it is not re-claimed, even across many more ticks
    await new Promise((r) => setTimeout(r, 120));
    expect(claims.filter((id) => id === doomed.id)).toHaveLength(1);

    // 4. the loop is still alive: a job queued afterwards is picked up and run
    const later = await seedJob(handle!.db, { variant: "mold" });
    expect(
      await waitFor(async () => (await statusOf(later.id)).status === "done"),
    ).toBe(true);
    expect(claims).toEqual([doomed.id, later.id]);

    // the crash line on stderr is scrubbed too
    const logged = stderr.mock.calls.map((c) => String(c[0])).join("");
    expect(logged).toContain(`job ${doomed.id} crashed`);
    expect(logged).not.toContain(SOLARI_SECRET);
  });
});
