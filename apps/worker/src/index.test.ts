import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  finishJob,
  getJobById,
  listEventsAfter,
  markJobRunning,
} from "@sensitiv/db";
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
      pollGraceMs: 0,
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

  const BYOK = "byok-solari-key";
  const post = (url: string, body: unknown) =>
    fetch(`${url}/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  it("leaves a just-created job for its POST, so the BYOK key it carries is used", async () => {
    const job = await seedJob(handle!.db);
    const runs: Array<{ jobId: string; key?: string }> = [];
    server = await startServer({
      port: 0,
      db: handle!.db,
      poll: true,
      pollIntervalMs: 10,
      env: loadEnv({}),
      runJob: async (_db, jobId, deps) => {
        runs.push({ jobId, key: deps?.solariKey });
        await finishJob(handle!.db, jobId, "done");
        return { status: "done", placeCount: 0, evidenceCount: 0, events: 0 };
      },
    });

    // Many poll ticks pass before the POST lands. Without the grace period the
    // loop claimed the job keyless on the first one.
    await new Promise((r) => setTimeout(r, 150));
    expect(runs).toEqual([]);
    expect((await post(server.url, { jobId: job.id, solariKey: BYOK })).status).toBe(202);

    expect(await waitFor(async () => runs.length === 1)).toBe(true);
    expect(runs).toEqual([{ jobId: job.id, key: BYOK }]);
  });

  it("hands a key that arrives while the claimed job is still waiting its turn to that run", async () => {
    const first = await seedJob(handle!.db);
    const second = await seedJob(handle!.db, { variant: "mold" });
    let release!: () => void;
    const blocked = new Promise<void>((r) => (release = r));
    const runs: Array<{ jobId: string; key?: string }> = [];
    server = await startServer({
      port: 0,
      db: handle!.db,
      poll: true,
      pollIntervalMs: 10,
      pollGraceMs: 0,
      env: loadEnv({}),
      runJob: async (_db, jobId, deps) => {
        runs.push({ jobId, key: deps?.solariKey });
        if (jobId === first.id) await blocked;
        await finishJob(handle!.db, jobId, "done");
        return { status: "done", placeCount: 0, evidenceCount: 0, events: 0 };
      },
    });

    // The poll loop has claimed both, keyless; the second is queued behind
    // the first when its POST arrives.
    expect(await waitFor(async () => runs.length === 1)).toBe(true);
    await new Promise((r) => setTimeout(r, 50));
    expect((await post(server.url, { jobId: second.id, solariKey: BYOK })).status).toBe(202);
    release();

    expect(await waitFor(async () => runs.length === 2)).toBe(true);
    expect(runs[1]).toEqual({ jobId: second.id, key: BYOK });
  });
});

describe("abandoned runs are finished at startup", () => {
  it("finishes a job left `running` by a dead process", async () => {
    // A job only leaves `running` in the process that claimed it. If that
    // process dies — a crash, a deploy, or `tsx watch` restarting on a source
    // edit — nothing else ever finishes the row: the poll loop claims only
    // `queued`, and the JobBudget that would have timed it out died with it.
    // The run page then spins forever, which is exactly what it did.
    const handle = await makeDb();
    const job = await seedJob(handle.db);
    await markJobRunning(handle.db, job.id);

    const server = await startServer({ port: 0, db: handle.db, env: loadEnv({}) });
    try {
      const after = await getJobById(handle.db, job.id);
      expect(after?.status).toBe("error");
      expect(after?.errorText).toMatch(/worker restarted/i);

      // And it says so in the log, which is what the run page actually renders.
      const events = await listEventsAfter(handle.db, job.id, 0);
      expect(events.some((e) => /worker restarted/i.test(e.message))).toBe(true);
    } finally {
      await server.close();
    }
  });

  it("leaves queued and finished jobs alone", async () => {
    const handle = await makeDb();
    const queued = await seedJob(handle.db);
    const done = await seedJob(handle.db);
    await markJobRunning(handle.db, done.id);
    await finishJob(handle.db, done.id, "done");

    const server = await startServer({ port: 0, db: handle.db, env: loadEnv({}) });
    try {
      expect((await getJobById(handle.db, queued.id))?.status).toBe("queued");
      expect((await getJobById(handle.db, done.id))?.status).toBe("done");
    } finally {
      await server.close();
    }
  });
});
