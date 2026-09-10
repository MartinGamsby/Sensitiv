// Acceptance gate (b): a QUEUED job, claimed the way production claims it,
// walks queued -> running -> done/partial and leaves a schema-valid `Dossier`
// persisted behind the `packages/db` repositories — with a `job_events` trail
// that brackets the run.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDossier, getJobById, listEventsAfter } from "@sensitiv/db";
import { DossierSchema } from "@sensitiv/shared";
import { loadEnv } from "@sensitiv/shared/env";
import { FakeLlmProvider } from "@sensitiv/shared/llm";
import { runJob } from "../src/runner.ts";
import { createJobLogger, type JobLogFn, type JobLogger } from "../src/logger.ts";
import { FixtureBrowserSession } from "../src/browser/fixture.ts";
import { startServer, type WorkerServer } from "../src/server.ts";
import { makeDb, seedJob, type TestDb } from "./helpers.ts";

let handle: TestDb | undefined;
let server: WorkerServer | undefined;

beforeEach(async () => {
  handle = await makeDb();
});

afterEach(async () => {
  await server?.close();
  server = undefined;
  handle?.client.close();
  handle = undefined;
});

/** Poll the raw `jobs` row until it reaches a terminal state (or the deadline). */
async function waitForTerminal(db: TestDb, jobId: string, ms = 15_000): Promise<string> {
  const deadline = Date.now() + ms;
  let status = "queued";
  while (Date.now() < deadline) {
    const row = await db.client.execute({
      sql: "SELECT status FROM jobs WHERE id = ?",
      args: [jobId],
    });
    status = String(row.rows[0]?.status);
    if (status === "done" || status === "partial" || status === "error") return status;
    await new Promise((r) => setTimeout(r, 25));
  }
  return status;
}

describe("job lifecycle — queued to persisted dossier", () => {
  it(
    "the worker poll loop claims a queued job and persists a schema-valid dossier",
    async () => {
      const db = handle!;
      const job = await seedJob(db.db);
      expect(job.status).toBe("queued");

      server = await startServer({
        port: 0,
        db: db.db,
        env: loadEnv({}), // an EMPTY .env: fake LLM + fixture browsers
        poll: true,
        pollIntervalMs: 25,
      });

      const status = await waitForTerminal(db, job.id);
      expect(["done", "partial"]).toContain(status);

      // Read back only through the repositories — the same path the web app uses.
      const dossier = await getDossier(db.db, job.id, job.userId);
      expect(dossier).toBeDefined();

      // ...and re-validate against the shared Zod contract, independently of
      // whatever `getDossier` happens to do internally.
      const parsed = DossierSchema.parse(dossier);
      expect(parsed.jobId).toBe(job.id);
      expect(parsed.status).toBe(status);
      expect(parsed.uiLocale).toBe("fr");
      expect(parsed.disclaimer).toContain("aide à la recherche");
      expect(parsed.places.length).toBeGreaterThan(0);
      expect(parsed.places.some((p) => p.evidence.length > 0)).toBe(true);
      for (const place of parsed.places) {
        expect(place.place.canonicalKey).not.toBe("");
        expect(place.sources.length).toBeGreaterThan(0);
      }
    },
    20_000,
  );

  it("status walks queued -> running -> done, stamping startedAt and finishedAt", async () => {
    const db = handle!;
    const job = await seedJob(db.db);
    expect(job.status).toBe("queued");
    expect(job.startedAt).toBeNull();

    // Sample the persisted status on every log line, so the transitions are
    // observed while the job runs rather than inferred afterwards. The runner
    // appends its closing event BEFORE flipping to a terminal status (so the SSE
    // tail can never close on a half-written log), so the terminal sample is
    // taken once the run returns rather than from inside a log call.
    const base = createJobLogger(db.db, job.id, { sink: () => undefined });
    const seen: string[] = [];
    const sample = async (): Promise<void> => {
      const current = await getJobById(db.db, job.id);
      if (current && seen.at(-1) !== current.status) seen.push(current.status);
    };
    const fn: JobLogFn = async (level, message, source) => {
      await sample();
      await base(level, message, source);
    };
    Object.defineProperty(fn, "count", { get: () => base.count });

    const outcome = await runJob(db.db, job.id, {
      llm: new FakeLlmProvider(),
      browserFactory: () => Promise.resolve(new FixtureBrowserSession()),
      logger: fn as JobLogger,
    });
    await sample();

    expect(outcome.status).toBe("done");
    expect(seen).toEqual(["running", "done"]);

    const finished = await getJobById(db.db, job.id);
    expect(finished?.status).toBe("done");
    expect(finished?.errorText).toBeNull();
    expect(finished?.startedAt).toBeTypeOf("number");
    expect(finished?.finishedAt).toBeTypeOf("number");
    expect(finished!.finishedAt!).toBeGreaterThanOrEqual(finished!.startedAt!);

    // The event trail brackets the run and is strictly ordered by cursor id.
    const events = await listEventsAfter(db.db, job.id, 0, 500);
    expect(events.length).toBeGreaterThan(5);
    expect(events[0]!.message).toMatch(/job started/i);
    expect(events.at(-1)!.message).toMatch(/job finished: done/i);
    expect(events.map((e) => e.id)).toEqual([...events.map((e) => e.id)].sort((a, b) => a - b));
    expect(outcome.events).toBe(events.length);
  });

  it("a job whose budget is spent before any adapter runs still persists a schema-valid partial dossier", async () => {
    const db = handle!;
    const job = await seedJob(db.db);

    const outcome = await runJob(db.db, job.id, {
      llm: new FakeLlmProvider(),
      browserFactory: () => Promise.resolve(new FixtureBrowserSession()),
      logSink: () => undefined,
      timeoutSec: 0, // already expired: no adapter is ever scheduled
      drainMs: 20,
    });

    expect(outcome.status).toBe("partial");

    const finished = await getJobById(db.db, job.id);
    expect(finished?.status).toBe("partial");
    expect(finished?.finishedAt).toBeTypeOf("number");

    const parsed = DossierSchema.parse(await getDossier(db.db, job.id, job.userId));
    expect(parsed.status).toBe("partial");
    expect(parsed.disclaimer).not.toBe("");

    const events = await listEventsAfter(db.db, job.id, 0, 500);
    expect(events.at(-1)!.message).toMatch(/job finished: partial/i);
  });
});
