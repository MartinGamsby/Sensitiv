import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { findRepoRoot, getDossier, getJobById, listEventsAfter } from "@sensitiv/db";
import { FakeLlmProvider, LlmError, type LlmProvider } from "@sensitiv/shared/llm";
import { runJob } from "../src/runner.ts";
import { AdapterRegistry } from "../src/registry.ts";
import { FixtureBrowserSession } from "../src/browser/fixture.ts";
import { __setSolariModuleLoader, type BrowserSession } from "../src/browser/solari.ts";
import type { Adapter } from "../src/adapters/types.ts";
import { makeDb, seedJob, type TestDb } from "./helpers.ts";

let handle: TestDb | undefined;
afterEach(() => {
  handle?.client.close();
  handle = undefined;
});

const fixtureFactory = async (): Promise<FixtureBrowserSession> =>
  new FixtureBrowserSession();

/** A "live" session — real capture-worthy replay metadata behind a fixture's
 *  page behavior, so an adapter can still run to completion without a real
 *  Solari client. `getReplayUrl`/`downloadReplay` are overridable per test. */
function stubLiveSession(
  overrides: Partial<
    Pick<BrowserSession, "getReplayUrl" | "downloadReplay">
  > = {},
): BrowserSession {
  const inner = new FixtureBrowserSession();
  return {
    sessionId: inner.sessionId,
    mode: "live",
    newPage: () => inner.newPage(),
    close: () => inner.close(),
    getReplayUrl: overrides.getReplayUrl ?? (async () => undefined),
    downloadReplay: overrides.downloadReplay ?? (async () => undefined),
  };
}

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

    // no browserFactory -> the real launchBrowser runs. Install a rejecting
    // module loader so it degrades to fixtures without ever reaching the
    // network — this test is about secret redaction, not the Solari SDK.
    __setSolariModuleLoader(() =>
      Promise.reject(new Error("Cannot find module")),
    );
    try {
      await runJob(handle.db, job.id, {
        solariKey: LEAK,
        llm: new FakeLlmProvider(),
      });
    } finally {
      __setSolariModuleLoader();
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

  it("a third-party error that embeds the key is scrubbed out of job_events", async () => {
    handle = await makeDb();
    const job = await seedJob(handle.db);
    const LEAK = "sk-solari-EMBEDDED-IN-SDK-ERROR";

    // Stands in for the Solari SDK: an error whose text carries the key (a
    // request URL, an "invalid api key: …" message). The adapter never receives
    // the key, so it cannot scrub — the logger sink has to.
    const leaky: Adapter = {
      id: "google_maps",
      supports: () => true,
      async run() {
        throw new Error(`POST https://api.solari.example/session?key=${LEAK} — 401`);
      },
    };

    const writes: string[] = [];
    const spy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(((chunk: unknown) => {
        writes.push(String(chunk));
        return true;
      }) as unknown as typeof process.stdout.write);

    try {
      await runJob(handle.db, job.id, {
        registry: new AdapterRegistry().register(leaky),
        llm: new FakeLlmProvider(),
        browserFactory: fixtureFactory,
        solariKey: LEAK,
      });
    } finally {
      spy.mockRestore();
    }

    const events = await listEventsAfter(handle.db, job.id, 0, 500);
    const text = events.map((e) => e.message).join("\n");
    expect(text).not.toContain(LEAK);
    // the diagnostic itself survives, just redacted
    expect(text).toMatch(/google_maps.*\*\*\*/s);
    expect(writes.join("")).not.toContain(LEAK);
  });

  it("a job-level failure scrubs the key out of jobs.error_text", async () => {
    handle = await makeDb();
    const job = await seedJob(handle.db);
    const LEAK = "sk-solari-IN-ERROR-TEXT";

    // `registry.resolve` runs inside runJob's try, before any adapter: a throw
    // here lands on the `error` path, which writes `error_text` directly.
    const registry = new AdapterRegistry();
    vi.spyOn(registry, "resolve").mockRejectedValue(
      new Error(`registry exploded (key=${LEAK})`),
    );

    const outcome = await runJob(handle.db, job.id, {
      registry,
      llm: new FakeLlmProvider(),
      browserFactory: fixtureFactory,
      logSink: () => undefined,
      solariKey: LEAK,
    });

    expect(outcome.status).toBe("error");
    const row = await getJobById(handle.db, job.id);
    expect(row?.errorText).toBeTruthy();
    expect(row?.errorText).not.toContain(LEAK);
    expect(row?.errorText).toContain("***");
  });
});

describe("runJob — degradation notices for the run page", () => {
  it("emits a `degraded-llm` event when the LLM provider is the fake fallback", async () => {
    handle = await makeDb();
    const job = await seedJob(handle.db);

    await runJob(handle.db, job.id, {
      llm: new FakeLlmProvider(),
      browserFactory: fixtureFactory,
      logSink: () => undefined,
    });

    const events = await listEventsAfter(handle.db, job.id, 0, 500);
    const notice = events.find((e) => e.source === "degraded-llm");
    expect(notice?.level).toBe("warn");
    expect(notice?.message).toMatch(/ANTHROPIC_API_KEY/);
  });

  it("emits a `degraded-llm` event when a configured Anthropic key is rejected", async () => {
    handle = await makeDb();
    const job = await seedJob(handle.db);

    // A provider that names itself "anthropic" but fails every call, the way
    // AnthropicProvider does on a bad/unreachable key.
    const rejecting: LlmProvider = {
      name: "anthropic",
      completeStructured: () =>
        Promise.reject(new LlmError("401 unauthorized", undefined, "auth")),
    };

    await runJob(handle.db, job.id, {
      llm: rejecting,
      browserFactory: fixtureFactory,
      logSink: () => undefined,
    });

    const events = await listEventsAfter(handle.db, job.id, 0, 500);
    const notice = events.find((e) => e.source === "degraded-llm");
    expect(notice?.level).toBe("warn");
    expect(notice?.message).toMatch(/failed|rejected|unreachable/i);
  });

  it("emits a single `degraded-solari` event when a Solari key is set but the browser falls back to fixtures, and the LLM is working", async () => {
    handle = await makeDb();
    const job = await seedJob(handle.db);

    // A working LLM (`llmUnusable` false) is what makes this `degraded-solari`
    // case distinct from `solari-skipped-no-llm` below: the browser fell back
    // to fixtures for its OWN reason, not because the run was gated shut.
    const okAnthropic: LlmProvider = {
      name: "anthropic",
      completeStructured: <T>() => Promise.resolve({ requirements: [] } as T),
    };

    await runJob(handle.db, job.id, {
      llm: okAnthropic,
      browserFactory: fixtureFactory, // fixture session despite the key
      solariKey: "slr_live_configured_but_unusable",
      logSink: () => undefined,
    });

    const events = await listEventsAfter(handle.db, job.id, 0, 500);
    const notices = events.filter((e) => e.source === "degraded-solari");
    expect(notices).toHaveLength(1);
    expect(notices[0]?.level).toBe("warn");
    expect(events.some((e) => e.source === "solari-skipped-no-llm")).toBe(false);
  });

  it("emits `solari-skipped-no-llm` — not `degraded-solari` — when a Solari key is set but the LLM is unusable", async () => {
    handle = await makeDb();
    const job = await seedJob(handle.db);
    vi.stubEnv("SOLARI_API_KEY", "slr_live_env_configured");

    try {
      await runJob(handle.db, job.id, {
        llm: new FakeLlmProvider(),
        browserFactory: fixtureFactory,
        logSink: () => undefined,
      });
    } finally {
      vi.unstubAllEnvs();
    }

    const events = await listEventsAfter(handle.db, job.id, 0, 500);
    const notice = events.find((e) => e.source === "solari-skipped-no-llm");
    expect(notice?.level).toBe("warn");
    expect(notice?.message).toMatch(/no working Anthropic key/i);
    expect(events.some((e) => e.source === "degraded-solari")).toBe(false);
  });

  it("stays quiet when the real providers are in use", async () => {
    handle = await makeDb();
    const job = await seedJob(handle.db);

    const okAnthropic: LlmProvider = {
      name: "anthropic",
      completeStructured: <T>() => Promise.resolve({ requirements: [] } as T),
    };

    await runJob(handle.db, job.id, {
      llm: okAnthropic,
      browserFactory: fixtureFactory,
      // no solariKey -> the "no key, running on fixtures" path, not a failure
      logSink: () => undefined,
    });

    const events = await listEventsAfter(handle.db, job.id, 0, 500);
    expect(events.some((e) => e.source?.startsWith("degraded-"))).toBe(false);
  });
});

describe("runJob — skip launching a browser for stub adapters", () => {
  it("only launches a browser for google_maps, not for the three needsBrowser: false stubs", async () => {
    handle = await makeDb();
    // The default registry + the default (celiac) job unions dining + grocery,
    // which resolves to all four registered adapters — google_maps, yelp,
    // find_me_gluten_free, store_locator.
    const job = await seedJob(handle.db);

    let calls = 0;
    const countingFactory = async (): Promise<FixtureBrowserSession> => {
      calls += 1;
      return new FixtureBrowserSession();
    };

    const okAnthropic: LlmProvider = {
      name: "anthropic",
      completeStructured: <T>() => Promise.resolve({ requirements: [] } as T),
    };

    const outcome = await runJob(handle.db, job.id, {
      llm: okAnthropic,
      browserFactory: countingFactory,
      logSink: () => undefined,
    });

    expect(outcome.status).toBe("done");
    expect(calls).toBe(1);

    const events = await listEventsAfter(handle.db, job.id, 0, 500);
    const text = events.map((e) => e.message).join("\n");
    expect(text).toMatch(/\[yelp\] no browser needed/);
    expect(text).toMatch(/\[find_me_gluten_free\] no browser needed/);
    expect(text).toMatch(/\[store_locator\] no browser needed/);
  });
});

describe("runJob — replay capture", () => {
  const okAnthropic: LlmProvider = {
    name: "anthropic",
    completeStructured: <T>() => Promise.resolve({ requirements: [] } as T),
  };
  const writtenJobIds: string[] = [];

  afterEach(async () => {
    // `storeReplay` writes under the real repo root (`findRepoRoot()` is not
    // injectable — both apps resolve it the same way on purpose), so clean up
    // whatever this describe block actually wrote to disk.
    for (const jobId of writtenJobIds.splice(0)) {
      await rm(resolve(findRepoRoot(), "data", "replays", jobId), {
        recursive: true,
        force: true,
      });
    }
  });

  it("a session that downloads bytes produces a stored replay row with the right adapter_id and finding_count", async () => {
    handle = await makeDb();
    const job = await seedJob(handle.db);
    writtenJobIds.push(job.id);

    const liveAdapter: Adapter = {
      id: "google_maps",
      supports: () => true,
      async run() {
        return {
          findings: [
            {
              place: { name: "A", canonicalKey: "a" },
              source: { source: "google_maps", sourceUrl: "https://maps.example/a" },
              evidence: [],
            },
            {
              place: { name: "B", canonicalKey: "b" },
              source: { source: "google_maps", sourceUrl: "https://maps.example/b" },
              evidence: [],
            },
          ],
        };
      },
    };

    const factory = async (): Promise<BrowserSession> =>
      stubLiveSession({
        getReplayUrl: async () => ({
          url: "https://replay.example/live",
          expiresAt: Date.now() + 900_000,
        }),
        downloadReplay: async () => ({
          bytes: new TextEncoder().encode('{"type":"nav"}\n'),
          gzipped: false,
        }),
      });

    const outcome = await runJob(handle.db, job.id, {
      registry: new AdapterRegistry().register(liveAdapter),
      llm: okAnthropic,
      browserFactory: factory,
      logSink: () => undefined,
    });

    expect(outcome.status).toBe("done");

    const dossier = await getDossier(handle.db, job.id, job.userId);
    expect(dossier?.replays).toHaveLength(1);
    const replay = dossier?.replays[0];
    expect(replay?.status).toBe("stored");
    expect(replay?.adapterId).toBe("google_maps");
    expect(replay?.findingCount).toBe(2);
    expect(replay?.sizeBytes).toBeGreaterThan(0);
    // `storedPath` never reaches the dossier.
    expect(JSON.stringify(replay)).not.toContain("data/replays");
  });

  it("a session whose download throws still finishes the job, recording a link_only replay", async () => {
    handle = await makeDb();
    const job = await seedJob(handle.db);
    writtenJobIds.push(job.id);

    const liveAdapter: Adapter = {
      id: "google_maps",
      supports: () => true,
      async run() {
        return { findings: [] };
      },
    };

    const factory = async (): Promise<BrowserSession> =>
      stubLiveSession({
        getReplayUrl: async () => ({
          url: "https://replay.example/still-live",
          expiresAt: Date.now() + 900_000,
        }),
        downloadReplay: async () => {
          throw new Error("gateway blew up");
        },
      });

    const outcome = await runJob(handle.db, job.id, {
      registry: new AdapterRegistry().register(liveAdapter),
      llm: okAnthropic,
      browserFactory: factory,
      logSink: () => undefined,
    });

    expect(outcome.status).toBe("done");

    const dossier = await getDossier(handle.db, job.id, job.userId);
    expect(dossier?.replays).toHaveLength(1);
    expect(dossier?.replays[0]?.status).toBe("link_only");
    expect(dossier?.replays[0]?.url).toBe("https://replay.example/still-live");
  });

  it("skips capture entirely for a fixture session — no replay row at all", async () => {
    handle = await makeDb();
    const job = await seedJob(handle.db);

    const outcome = await runJob(handle.db, job.id, {
      llm: new FakeLlmProvider(),
      browserFactory: fixtureFactory,
      logSink: () => undefined,
    });

    expect(outcome.status).toBe("done");
    const dossier = await getDossier(handle.db, job.id, job.userId);
    expect(dossier?.replays).toHaveLength(0);
  });
});
