import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { findRepoRoot, getDossier, getJobById, listEventsAfter } from "@sensitiv/db";
import { FakeLlmProvider, LlmError, type LlmProvider } from "@sensitiv/shared/llm";
import { runJob } from "../src/runner.ts";
import { AdapterRegistry } from "../src/registry.ts";
import { createDefaultRegistry } from "../src/adapters/index.ts";
import { FixtureBrowserSession } from "../src/browser/fixture.ts";
import {
  __setSolariModuleLoader,
  REPLAY_TOO_LARGE,
  type BrowserSession,
  type LaunchOptions,
} from "../src/browser/solari.ts";
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
    Pick<BrowserSession, "getReplayUrl" | "downloadReplay" | "recording">
  > = {},
): BrowserSession {
  const inner = new FixtureBrowserSession();
  return {
    sessionId: inner.sessionId,
    mode: "live",
    // Recording on: these are the tests that exercise the replay-capture path.
    recording: overrides.recording ?? true,
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
    // `openstreetmap`, not `yelp`: the second adapter has to be an id the
    // seeded job's intents actually resolve, and `yelp` is no longer one of
    // them — an intent may not promise a source we have refused to build.
    const fast: Adapter = {
      id: "openstreetmap",
      supports: () => true,
      async run() {
        return {
          findings: [
            {
              place: { name: "Quick Place", canonicalKey: "quick place 1" },
              source: { source: "openstreetmap", sourceUrl: "https://osm.example/x" },
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
      id: "openstreetmap",
      supports: () => true,
      async run() {
        return {
          findings: [
            {
              place: { name: "Still Here", canonicalKey: "still here 9" },
              source: { source: "openstreetmap", sourceUrl: "https://osm.example/y" },
              evidence: [
                {
                  requirementId: "celiac",
                  claim: "ok",
                  polarity: "supports",
                  quote: "",
                  source: "openstreetmap",
                  sourceUrl: "https://osm.example/y",
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

describe("runJob — only browser adapters launch a browser", () => {
  it("launches one for google_maps and none for the API adapter", async () => {
    handle = await makeDb();
    // The default (celiac) job unions dining + grocery, which now resolves to
    // google_maps + openstreetmap (real) plus store_locator (declared, not
    // built — the registry logs and skips it).
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
    expect(text).toMatch(/\[openstreetmap\] no browser needed/);
    // Nothing "ran and contributed nothing" any more: the three no-op
    // adapters are deleted, so an unbuilt id is skipped before it can log.
    expect(text).not.toMatch(/\[yelp\]/);
    expect(text).not.toMatch(/\[find_me_gluten_free\]/);
    expect(text).toMatch(/store_locator.*not registered/);
  });
});

describe("runJob — source-mode provenance", () => {
  it("records a mode per source, and none for a source that did not run", async () => {
    handle = await makeDb();
    const job = await seedJob(handle.db);

    const outcome = await runJob(handle.db, job.id, {
      llm: new FakeLlmProvider(),
      browserFactory: fixtureFactory,
      logSink: () => undefined,
    });

    expect(outcome.status).toBe("done");
    const row = await getJobById(handle.db, job.id);
    expect(row?.sourceModes?.llm).toBe("fixture");
    expect(row?.sourceModes?.google_maps).toBe("fixture");
    // `openstreetmap` needs no browser but is a REAL source, and it is the
    // only thing that knows whether it reached Overpass, so it reports its
    // own mode rather than inheriting a guess from the runner.
    expect(row?.sourceModes?.openstreetmap).toBeDefined();
    // A declared-but-unbuilt id never resolves to an adapter, so there is
    // nothing to record a mode for. `"stub"` is not written by any path any
    // more; it survives only in rows from before the no-op adapters went.
    expect(row?.sourceModes?.store_locator).toBeUndefined();
    expect(Object.values(row?.sourceModes ?? {})).not.toContain("stub");
  });

  it("records a live mode for the llm and for a browser session that actually launched live", async () => {
    handle = await makeDb();
    const job = await seedJob(handle.db);
    const okAnthropic: LlmProvider = {
      name: "anthropic",
      completeStructured: <T>() => Promise.resolve({ requirements: [] } as T),
    };
    const liveAdapter: Adapter = {
      id: "google_maps",
      supports: () => true,
      async run() {
        return { findings: [] };
      },
    };

    const outcome = await runJob(handle.db, job.id, {
      registry: new AdapterRegistry().register(liveAdapter),
      llm: okAnthropic,
      browserFactory: async () => stubLiveSession(),
      logSink: () => undefined,
    });

    expect(outcome.status).toBe("done");
    const row = await getJobById(handle.db, job.id);
    expect(row?.sourceModes).toEqual({ llm: "live", google_maps: "live" });
  });

  it("a rejected Anthropic key (auth failure) records the llm as fixture, not live", async () => {
    handle = await makeDb();
    const job = await seedJob(handle.db);
    const rejecting: LlmProvider = {
      name: "anthropic",
      completeStructured: () =>
        Promise.reject(new LlmError("401 unauthorized", undefined, "auth")),
    };

    const outcome = await runJob(handle.db, job.id, {
      llm: rejecting,
      browserFactory: fixtureFactory,
      logSink: () => undefined,
    });

    expect(outcome.status).toBe("done");
    const row = await getJobById(handle.db, job.id);
    expect(row?.sourceModes?.llm).toBe("fixture");
  });

  it("persists sourceModes on the timeout/partial path too", async () => {
    handle = await makeDb();
    const job = await seedJob(handle.db);
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
    const registry = new AdapterRegistry().register(slow);

    const outcome = await runJob(handle.db, job.id, {
      registry,
      llm: new FakeLlmProvider(),
      browserFactory: fixtureFactory,
      logSink: () => undefined,
      timeoutSec: 0.25,
      drainMs: 80,
    });

    expect(outcome.status).toBe("partial");
    const row = await getJobById(handle.db, job.id);
    expect(row?.sourceModes?.llm).toBe("fixture");
  });

  it("persists sourceModes on the job-error path too, not just done/partial", async () => {
    handle = await makeDb();
    const job = await seedJob(handle.db);
    // Fails the job AFTER the planner has recorded the llm mode. The run is a
    // write-off, but what it did record is real — dropping it makes History
    // claim "this run predates provenance tracking" for a run that has it.
    const brokenRegistry = new AdapterRegistry();
    brokenRegistry.resolve = () => Promise.reject(new Error("registry exploded"));

    const outcome = await runJob(handle.db, job.id, {
      registry: brokenRegistry,
      llm: new FakeLlmProvider(),
      browserFactory: fixtureFactory,
      logSink: () => undefined,
    });

    expect(outcome.status).toBe("error");
    const row = await getJobById(handle.db, job.id);
    expect(row?.status).toBe("error");
    expect(row?.sourceModes?.llm).toBe("fixture");
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

  it("an opted-out job never records: launchBrowser is told recording: false and no replay row is written", async () => {
    // `jobs.record_session` is the authority, not an env flag — the poll loop
    // can claim a job without ever seeing the HTTP body that created it.
    handle = await makeDb();
    const job = await seedJob(handle.db, { overrides: { recordSession: false } });

    const liveAdapter: Adapter = {
      id: "google_maps",
      supports: () => true,
      run: async () => ({ findings: [] }),
    };

    const seenRecording: Array<boolean | undefined> = [];
    let replayAsked = 0;
    const factory = async (o: LaunchOptions): Promise<BrowserSession> => {
      seenRecording.push(o.recording);
      return stubLiveSession({
        recording: o.recording === true,
        getReplayUrl: async () => {
          replayAsked += 1;
          return { url: "https://replay.example/x", expiresAt: Date.now() + 1000 };
        },
      });
    };

    const outcome = await runJob(handle.db, job.id, {
      registry: new AdapterRegistry().register(liveAdapter),
      llm: okAnthropic,
      browserFactory: factory,
      logSink: () => undefined,
    });

    expect(outcome.status).toBe("done");
    expect(seenRecording).toEqual([false]);
    // Not merely "no row": the capture path is skipped outright, so nothing
    // asks the gateway for a link that was never going to exist.
    expect(replayAsked).toBe(0);
    const dossier = await getDossier(handle.db, job.id, job.userId);
    expect(dossier?.replays).toHaveLength(0);
    expect(dossier?.recordSession).toBe(false);
  });

  it("an opted-in job asks for recording and keeps its replay row", async () => {
    handle = await makeDb();
    const job = await seedJob(handle.db, { overrides: { recordSession: true } });
    writtenJobIds.push(job.id);

    const liveAdapter: Adapter = {
      id: "google_maps",
      supports: () => true,
      run: async () => ({ findings: [] }),
    };

    const seenRecording: Array<boolean | undefined> = [];
    const factory = async (o: LaunchOptions): Promise<BrowserSession> => {
      seenRecording.push(o.recording);
      return stubLiveSession({
        recording: true,
        getReplayUrl: async () => ({
          url: "https://replay.example/opted-in",
          expiresAt: Date.now() + 900_000,
        }),
        downloadReplay: async () => ({
          bytes: new TextEncoder().encode('{"type":"nav"}\n'),
          gzipped: false,
        }),
      });
    };

    await runJob(handle.db, job.id, {
      registry: new AdapterRegistry().register(liveAdapter),
      llm: okAnthropic,
      browserFactory: factory,
      logSink: () => undefined,
    });

    expect(seenRecording).toEqual([true]);
    const dossier = await getDossier(handle.db, job.id, job.userId);
    expect(dossier?.replays).toHaveLength(1);
    expect(dossier?.recordSession).toBe(true);
  });

  it("a recording over the cap is recorded as too_large, not as unavailable", async () => {
    handle = await makeDb();
    const job = await seedJob(handle.db);

    const liveAdapter: Adapter = {
      id: "google_maps",
      supports: () => true,
      run: async () => ({ findings: [] }),
    };
    const factory = async (): Promise<BrowserSession> =>
      stubLiveSession({
        // What `SolariBrowserSession.downloadReplay` returns for a buffer over
        // `REPLAY_MAX_BYTES`. The dossier and both locales already render this
        // status; before this it was unreachable and showed as "unavailable".
        downloadReplay: async () => REPLAY_TOO_LARGE,
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
    expect(dossier?.replays[0]?.status).toBe("too_large");
  });
});

/**
 * Seams no single section could exercise on its own: section 1's live gate
 * feeding section 3's persisted provenance, and section 1's "stub adapters
 * never launch a browser" feeding section 2's per-replay rows. Both go through
 * the REAL `launchBrowser` / real stub adapters rather than an injected
 * `browserFactory`, which is the only way the gate itself is on the path.
 */
describe("runJob — cross-section seams", () => {
  const okAnthropic: LlmProvider = {
    name: "anthropic",
    completeStructured: <T>() => Promise.resolve({ requirements: [] } as T),
  };
  const writtenJobIds: string[] = [];

  afterEach(async () => {
    __setSolariModuleLoader();
    for (const jobId of writtenJobIds.splice(0)) {
      await rm(resolve(findRepoRoot(), "data", "replays", jobId), {
        recursive: true,
        force: true,
      });
    }
  });

  it("a Solari key with an unusable LLM never loads the SDK, and every browser-backed source is persisted as fixture", async () => {
    handle = await makeDb();
    const job = await seedJob(handle.db);

    // If the gate regressed, `launchBrowser` would reach for the module; the
    // in-test default loader refuses the network, so the run would still end
    // up on fixtures and a mode-only assertion would pass anyway. Counting
    // loader calls is what actually proves nothing was spent.
    let loaderCalls = 0;
    __setSolariModuleLoader(() => {
      loaderCalls += 1;
      return Promise.reject(new Error("the allowLive gate let a launch through"));
    });

    const SOLARI_KEY = "slr_live_cross_section_0001";
    const outcome = await runJob(handle.db, job.id, {
      // Deliberately NO browserFactory — `launchBrowser` must be on the path.
      llm: new FakeLlmProvider(),
      solariKey: SOLARI_KEY,
      logSink: () => undefined,
    });

    expect(outcome.status).toBe("done");
    expect(loaderCalls).toBe(0);

    // Section 3: the run is marked sample-data because of what it DID, not
    // because a key is missing — a Solari key was in fact present.
    const row = await getJobById(handle.db, job.id);
    expect(row?.sourceModes?.llm).toBe("fixture");
    expect(row?.sourceModes?.google_maps).toBe("fixture");

    const events = await listEventsAfter(handle.db, job.id, 0, 500);
    expect(events.some((e) => e.source === "solari-skipped-no-llm")).toBe(true);
    // "could not start" would be a lie — this run never tried.
    expect(events.some((e) => e.source === "degraded-solari")).toBe(false);
    const text = events.map((e) => e.message).join("\n");
    expect(text).toMatch(/live browser disabled for this run/);
    expect(text).not.toContain(SOLARI_KEY);

    // Section 2: a gated run captured nothing, so there is no replay row at
    // all — never an empty recording.
    const dossier = await getDossier(handle.db, job.id, job.userId);
    expect(dossier?.replays).toHaveLength(0);
  });

  it("a mixed run stores one replay for the browser adapter and none for the needsBrowser:false stubs", async () => {
    handle = await makeDb();
    const job = await seedJob(handle.db);
    writtenJobIds.push(job.id);

    // The three real v1.1 stubs, plus a stand-in for google_maps that does not
    // drive the live scraping loop (registering by the same id replaces it).
    const registry = createDefaultRegistry().register({
      id: "google_maps",
      supports: () => true,
      needsBrowser: true,
      run: async () => ({ findings: [] }),
    });

    const factory = async (): Promise<BrowserSession> =>
      stubLiveSession({
        getReplayUrl: async () => ({
          url: "https://replay.example/mixed",
          expiresAt: Date.now() + 900_000,
        }),
        downloadReplay: async () => ({
          bytes: new TextEncoder().encode('{"type":"nav"}\n'),
          gzipped: false,
        }),
      });

    const outcome = await runJob(handle.db, job.id, {
      registry,
      llm: okAnthropic,
      browserFactory: factory,
      // `openstreetmap` reads an API rather than a browser, so "fully live" for
      // it means a reachable Nominatim AND Overpass. Without this it would
      // degrade to its fixture and the assertion below would be about the
      // wrong thing. The seeded job carries a postal code and no coordinates,
      // which is exactly the case that needs the geocode hop.
      fetchImpl: ((url: string | URL) =>
        Promise.resolve(
          new Response(
            String(url).includes("nominatim")
              ? JSON.stringify([
                  { lat: "45.5233", lon: "-73.5858", boundingbox: ["45.5", "45.6", "-73.6", "-73.5"] },
                ])
              : JSON.stringify({ elements: [] }),
            { status: 200 },
          ),
        )) as unknown as typeof fetch,
      logSink: () => undefined,
    });

    expect(outcome.status).toBe("done");

    // Exactly one replay row — an adapter that never opened a browser
    // contributes no row rather than an "empty recording" one.
    const dossier = await getDossier(handle.db, job.id, job.userId);
    expect(dossier?.replays.map((r) => r.adapterId)).toEqual(["google_maps"]);
    expect(dossier?.replays[0]?.status).toBe("stored");

    // ...while provenance is still recorded per source. Note there is no
    // `"fixture"` anywhere here: this is a fully live run, so the dossier's
    // sample-data strip and the History badge must stay silent. And no
    // `"stub"` either — every id in this map is a source that really ran.
    const row = await getJobById(handle.db, job.id);
    expect(row?.sourceModes).toEqual({
      llm: "live",
      google_maps: "live",
      // Live despite `needsBrowser: false` — it reported its own mode, which
      // is what stops a real API-reading source being mistaken for one that
      // did not run.
      openstreetmap: "live",
    });
    expect(Object.values(row?.sourceModes ?? {})).not.toContain("stub");
    expect(Object.values(row?.sourceModes ?? {})).not.toContain("fixture");
  });
});

describe("browser context geo hints", () => {
  /** Capture the `LaunchOptions` the runner builds, then serve a fixture. */
  function capturingFactory(seen: LaunchOptions[]) {
    return (opts: LaunchOptions) => {
      seen.push(opts);
      return Promise.resolve(new FixtureBrowserSession(opts.fixture) as BrowserSession);
    };
  }

  it("tells the browser where it is when the job carries trustworthy coordinates", async () => {
    const handle = await makeDb();
    const job = await seedJob(handle.db, {
      overrides: {
        location: { query: "Plateau-Mont-Royal, Montreal", lat: 45.52, lng: -73.58 },
      },
    });
    const seen: LaunchOptions[] = [];

    await runJob(handle.db, job.id, {
      llm: new FakeLlmProvider(),
      browserFactory: capturingFactory(seen),
      logSink: () => undefined,
    });

    const withContext = seen.find((o) => o.context?.geolocation);
    expect(withContext?.context?.geolocation).toEqual({
      latitude: 45.52,
      longitude: -73.58,
    });
    expect(withContext?.context?.permissions).toContain("geolocation");
  });

  it("sends NO geolocation when the job has a postal code", async () => {
    // `lat`/`lng` are geocoded from the free-text query, which is coarser than
    // a postal code by definition and can be far coarser: "Quebec, Canada"
    // resolves to the province, whose centroid sits in Eeyou Istchee James Bay,
    // ~700 km from the H1S typed beside it. Telling the browser it is standing
    // there is worse than telling it nothing — the adapter's Maps hop is the
    // authority once a postal code exists.
    const handle = await makeDb();
    const job = await seedJob(handle.db, {
      overrides: {
        location: {
          query: "Quebec, Canada",
          postalCode: "H1S",
          lat: 52.47609,
          lng: -71.82587,
        },
      },
    });
    const seen: LaunchOptions[] = [];

    await runJob(handle.db, job.id, {
      llm: new FakeLlmProvider(),
      browserFactory: capturingFactory(seen),
      logSink: () => undefined,
    });

    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((o) => o.context?.geolocation === undefined)).toBe(true);
    // The locale hint is unrelated and still goes out.
    expect(seen.some((o) => o.context?.locale)).toBe(true);
  });

  it("a PINNED location outranks the postal code and is sent", async () => {
    // The inversion the map pin introduces. Geocoded coordinates lose to a
    // postal code because they are coarser than one; a pin is FINER than one —
    // the user pointed at a spot, not at a delivery area — so nothing may
    // override it.
    const handle = await makeDb();
    const job = await seedJob(handle.db, {
      overrides: {
        location: {
          query: "Ville-Marie, Montreal",
          postalCode: "H2T",
          lat: 45.4914,
          lng: -73.5832,
          pinned: true,
        },
      },
    });
    const seen: LaunchOptions[] = [];

    await runJob(handle.db, job.id, {
      llm: new FakeLlmProvider(),
      browserFactory: capturingFactory(seen),
      logSink: () => undefined,
    });

    const withContext = seen.find((o) => o.context?.geolocation);
    expect(withContext?.context?.geolocation).toEqual({
      latitude: 45.4914,
      longitude: -73.5832,
    });
  });
});
