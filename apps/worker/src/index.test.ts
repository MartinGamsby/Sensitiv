import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
});

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
