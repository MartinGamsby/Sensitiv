import { afterEach, describe, expect, it, vi } from "vitest";
import { getDossier, listEventsAfter } from "@sensitiv/db";
import { FakeLlmProvider } from "@sensitiv/shared/llm";
import { runJob } from "../src/runner.ts";
import { AdapterRegistry } from "../src/registry.ts";
import { FixtureBrowserSession } from "../src/browser/fixture.ts";
import type { Adapter } from "../src/adapters/types.ts";
import { makeDb, seedJob, type TestDb } from "./helpers.ts";

let handle: TestDb | undefined;
afterEach(() => {
  handle?.client.close();
  handle = undefined;
});

const fixtureFactory = async (): Promise<FixtureBrowserSession> =>
  new FixtureBrowserSession();

describe("runJob — dummy end-to-end", () => {
  it("fixtures + fake LLM produce a valid dossier with ordered narrative events", async () => {
    handle = await makeDb();
    const job = await seedJob(handle.db);

    const outcome = await runJob(handle.db, job.id, {
      llm: new FakeLlmProvider(),
      browserFactory: fixtureFactory,
      logSink: () => undefined,
    });

    expect(outcome.status).toBe("done");

    const dossier = await getDossier(handle.db, job.id, job.userId);
    expect(dossier?.status).toBe("done");
    expect(dossier?.disclaimer).toContain("aide à la recherche");
    expect(dossier?.places.length).toBeGreaterThan(0);
    expect(dossier?.places.filter((p) => p.evidence.length > 0).length).toBeGreaterThan(0);

    // the amber (conflicted) place survives into the dossier
    expect(dossier?.places.some((p) => p.conflicted)).toBe(true);

    const events = await listEventsAfter(handle.db, job.id, 0, 500);
    expect(events.length).toBeGreaterThan(15);
    expect(events.map((e) => e.id)).toEqual(
      [...events.map((e) => e.id)].sort((a, b) => a - b),
    );
    const text = events.map((e) => e.message).join("\n");
    for (const step of [
      /job started/i,
      /search language/i,
      /planned \d+ requirement/i,
      /adapters \[/i,
      /merging \d+ finding/i,
      /distinct place/i,
      /job finished: done/i,
    ]) {
      expect(text).toMatch(step);
    }
  });
});

describe("runJob — resilience", () => {
  it("timeout → status partial, browsers closed, partial results still written", async () => {
    handle = await makeDb();
    const job = await seedJob(handle.db);

    const closed: string[] = [];
    const factory = async () => {
      const session = new FixtureBrowserSession();
      const original = session.close.bind(session);
      session.close = async () => {
        closed.push(session.sessionId);
        return original();
      };
      return session;
    };

    const slow: Adapter = {
      id: "google_maps",
      supports: () => true,
      async run(ctx) {
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(resolve, 5_000);
          ctx.signal.addEventListener("abort", () => {
            clearTimeout(t);
            reject(new Error("aborted"));
          });
        });
        return { findings: [] };
      },
    };
    const fast: Adapter = {
      id: "yelp",
      supports: () => true,
      async run() {
        return {
          findings: [
            {
              place: { name: "Quick Place", canonicalKey: "quick place 1" },
              source: { source: "yelp", sourceUrl: "https://yelp.example/x" },
              evidence: [],
            },
          ],
        };
      },
    };

    const registry = new AdapterRegistry().register(slow).register(fast);

    const outcome = await runJob(handle.db, job.id, {
      registry,
      llm: new FakeLlmProvider(),
      browserFactory: factory,
      logSink: () => undefined,
      timeoutSec: 0.25,
      drainMs: 80,
    });

    expect(outcome.status).toBe("partial");
    expect(closed.length).toBeGreaterThanOrEqual(1);

    const dossier = await getDossier(handle.db, job.id, job.userId);
    expect(dossier?.status).toBe("partial");
    expect(dossier?.places.some((p) => p.place.name === "Quick Place")).toBe(true);
  });

  it("one adapter throwing does not fail the job; an error event names it", async () => {
    handle = await makeDb();
    const job = await seedJob(handle.db);

    const boom: Adapter = {
      id: "google_maps",
      supports: () => true,
      async run() {
        throw new Error("selector blew up");
      },
    };
    const ok: Adapter = {
      id: "yelp",
      supports: () => true,
      async run() {
        return {
          findings: [
            {
              place: { name: "Still Here", canonicalKey: "still here 9" },
              source: { source: "yelp", sourceUrl: "https://yelp.example/y" },
              evidence: [
                {
                  requirementId: "celiac",
                  claim: "ok",
                  polarity: "supports",
                  quote: "",
                  source: "yelp",
                  sourceUrl: "https://yelp.example/y",
                  confidence: 0.9,
                },
              ],
            },
          ],
        };
      },
    };

    const registry = new AdapterRegistry().register(boom).register(ok);
    const outcome = await runJob(handle.db, job.id, {
      registry,
      llm: new FakeLlmProvider(),
      browserFactory: fixtureFactory,
      logSink: () => undefined,
    });

    expect(outcome.status).toBe("done");
    const events = await listEventsAfter(handle.db, job.id, 0, 500);
    const errors = events.filter((e) => e.level === "error");
    expect(errors.some((e) => e.message.includes("google_maps"))).toBe(true);
    const dossier = await getDossier(handle.db, job.id, job.userId);
    expect(dossier?.places.some((p) => p.place.name === "Still Here")).toBe(true);
  });

  it("a housing job whose intents union kijiji/craigslist completes with a warning", async () => {
    handle = await makeDb();
    const job = await seedJob(handle.db, { variant: "mold" });

    const outcome = await runJob(handle.db, job.id, {
      llm: new FakeLlmProvider(),
      browserFactory: fixtureFactory,
      logSink: () => undefined,
    });

    expect(["done", "partial"]).toContain(outcome.status);
    const events = await listEventsAfter(handle.db, job.id, 0, 500);
    const warnings = events.filter((e) => e.level === "warn").map((e) => e.message);
    expect(warnings.join("\n")).toMatch(/kijiji.*not registered/);
  });
});

describe("runJob — secret handling", () => {
  it("a BYOK Solari key never reaches events, DB rows, or stdout", async () => {
    handle = await makeDb();
    const job = await seedJob(handle.db);
    const LEAK = "sk-test-LEAKME";

    const writes: string[] = [];
    const record = (chunk: unknown): boolean => {
      writes.push(typeof chunk === "string" ? chunk : String(chunk));
      return true;
    };
    const spy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(record as unknown as typeof process.stdout.write);

    try {
      // no browserFactory -> the real launchBrowser runs, the SDK import fails,
      // and it degrades to fixtures. The key must not surface anywhere.
      await runJob(handle.db, job.id, {
        solariKey: LEAK,
        llm: new FakeLlmProvider(),
      });
    } finally {
      spy.mockRestore();
    }

    const events = await listEventsAfter(handle.db, job.id, 0, 500);
    expect(events.some((e) => e.message.includes(LEAK))).toBe(false);

    for (const table of [
      "jobs",
      "job_events",
      "places",
      "place_sources",
      "evidence",
      "replays",
    ]) {
      const dump = await handle.client.execute(`SELECT * FROM ${table}`);
      expect(JSON.stringify(dump.rows)).not.toContain(LEAK);
    }
    expect(writes.join("")).not.toContain(LEAK);
  });
});
