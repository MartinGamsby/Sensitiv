// Acceptance gate (a), adapter half: with an EMPTY `.env` every adapter still
// gets a browser. `launchBrowser` must degrade to `FixtureBrowserSession` —
// never throw, never wait on a network, never echo the key it was handed.
//
// `@solarisdk/browser` is a real, installed dependency (see section-1 of
// memory/next-steps.md), so the live path below is driven entirely through
// `__setSolariModuleLoader` — zero network calls, per
// memory/running-and-testing.md.
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  __setSolariModuleLoader,
  launchBrowser,
  type BrowserSession,
  type LaunchOptions,
} from "./solari.ts";
import { FixtureBrowserSession } from "./fixture.ts";
import type { JobLogLevel } from "../logger.ts";

interface Line {
  level: JobLogLevel;
  message: string;
}

function recorder(): {
  lines: Line[];
  log: (level: JobLogLevel, message: string) => Promise<void>;
} {
  const lines: Line[] = [];
  return {
    lines,
    log: (level, message) => {
      lines.push({ level, message });
      return Promise.resolve();
    },
  };
}

function opts(extra: Partial<LaunchOptions> = {}): LaunchOptions {
  const { log } = recorder();
  return {
    jobId: "job-1",
    location: { country: "ca" },
    log,
    ...extra,
  };
}

/** A stub `@solarisdk/browser` module: a fake `Solari` client whose
 *  `launch`/`sessions` are driven per-test, fed in through
 *  `__setSolariModuleLoader`. Zero network. */
function stubBrowser(overrides: Partial<{ id: string }> = {}) {
  return {
    id: overrides.id ?? "sess-abc123",
    newPage: vi.fn().mockResolvedValue({
      goto: vi.fn().mockResolvedValue(undefined),
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn().mockResolvedValue(undefined),
      content: vi.fn().mockResolvedValue("<html></html>"),
      close: vi.fn().mockResolvedValue(undefined),
    }),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

function stubModule(client: {
  launch: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  sessions: {
    getReplayUrl: ReturnType<typeof vi.fn>;
    releaseAndWait?: ReturnType<typeof vi.fn>;
  };
}) {
  class Solari {
    sessions = client.sessions;
    launch = client.launch;
    close = client.close;
  }
  return { Solari };
}

function stubClient(browser: ReturnType<typeof stubBrowser>) {
  return {
    launch: vi.fn().mockResolvedValue(browser),
    close: vi.fn().mockResolvedValue(undefined),
    sessions: {
      getReplayUrl: vi.fn().mockResolvedValue(undefined),
      releaseAndWait: vi.fn().mockResolvedValue(undefined),
    },
  };
}

afterEach(() => {
  __setSolariModuleLoader();
});

describe("launchBrowser — empty .env fallback", () => {
  it("returns a fixture session when no Solari key is set", async () => {
    const rec = recorder();
    const session = await launchBrowser(opts({ log: rec.log }));

    expect(session).toBeInstanceOf(FixtureBrowserSession);
    expect(session.mode).toBe("fixture");
    expect(session.sessionId).toMatch(/^fixture-/);
    expect(rec.lines.map((l) => l.message).join("\n")).toMatch(/no Solari key/i);
    await session.close();
  });

  it("treats a whitespace-only key as absent", async () => {
    const rec = recorder();
    const session = await launchBrowser(opts({ apiKey: "   ", log: rec.log }));
    expect(session.mode).toBe("fixture");
    expect(rec.lines.some((l) => /no Solari key/i.test(l.message))).toBe(true);
    await session.close();
  });

  it("serves the recorded payload and reports no replay URL", async () => {
    const payload = { blob: { places: [{ name: "Fixture Cafe" }] } };
    const session = await launchBrowser(opts({ fixture: payload }));

    const page = await session.newPage();
    await page.goto("https://example.invalid/search");
    expect(await page.evaluate<{ places: unknown[] }>(() => ({ places: [] }))).toEqual(
      payload.blob,
    );
    expect(await page.content()).toContain("Fixture Cafe");
    expect(await session.getReplayUrl()).toBeUndefined();

    await session.close();
    expect((session as FixtureBrowserSession).closed).toBe(true);
  });

  it("hands control to the injected factory and skips all Solari plumbing", async () => {
    const rec = recorder();
    const injected = new FixtureBrowserSession({ blob: "injected" });
    const factory = (): Promise<BrowserSession> => Promise.resolve(injected);

    const session = await launchBrowser(
      opts({ apiKey: "solari-live-should-be-ignored", log: rec.log, factory }),
    );

    expect(session).toBe(injected);
    expect(rec.lines).toHaveLength(0);
  });
});

describe("launchBrowser — module fails to load", () => {
  it("degrades to fixtures when the module fails to load, without echoing the key", async () => {
    const KEY = "solari-live-LEAKME-0001";
    __setSolariModuleLoader(() =>
      Promise.reject(new Error("Cannot find module")),
    );
    const rec = recorder();

    const session = await launchBrowser(opts({ apiKey: KEY, log: rec.log }));

    expect(session.mode).toBe("fixture");
    const warnings = rec.lines.filter((l) => l.level === "warn");
    expect(warnings.some((l) => /falling back to fixtures/i.test(l.message))).toBe(true);
    expect(JSON.stringify(rec.lines)).not.toContain(KEY);
    await session.close();
  });

  it("degrades to fixtures when the resolved module has no Solari export", async () => {
    __setSolariModuleLoader(() => Promise.resolve({}));
    const rec = recorder();

    const session = await launchBrowser(opts({ apiKey: "slr_live_x_y", log: rec.log }));

    expect(session.mode).toBe("fixture");
    expect(
      rec.lines.some((l) => l.level === "warn" && /falling back to fixtures/i.test(l.message)),
    ).toBe(true);
  });
});

describe("launchBrowser — live Solari client (stubbed, zero network)", () => {
  it("happy path: launches, exposes a wrapped page, and reports mode live", async () => {
    const browser = stubBrowser({ id: "sess-happy" });
    const client = stubClient(browser);
    __setSolariModuleLoader(() => Promise.resolve(stubModule(client)));

    const session = await launchBrowser(opts({ apiKey: "slr_live_x_y" }));

    expect(session.mode).toBe("live");
    expect(session.sessionId).toBe("sess-happy");

    const page = await session.newPage();
    expect(typeof page.goto).toBe("function");
    expect(typeof page.evaluate).toBe("function");
    expect(typeof page.content).toBe("function");
    expect(typeof page.close).toBe("function");

    await session.close();
  });

  it("unwraps the replay URL object into the plain string the schema requires", async () => {
    const browser = stubBrowser();
    const client = stubClient(browser);
    client.sessions.getReplayUrl.mockResolvedValue({
      url: "https://replay.example/abc",
      expiresInSeconds: 3600,
      contentEncoding: "gzip",
    });
    __setSolariModuleLoader(() => Promise.resolve(stubModule(client)));

    const session = await launchBrowser(opts({ apiKey: "slr_live_x_y" }));
    const result = await session.getReplayUrl();

    expect(typeof result).toBe("string");
    expect(result).toBe("https://replay.example/abc");
    expect(z.array(z.string()).safeParse([result]).success).toBe(true);

    await session.close();
  });

  it("getReplayUrl rejects -> resolves undefined and warns, never throws", async () => {
    const browser = stubBrowser();
    const client = stubClient(browser);
    client.sessions.getReplayUrl.mockRejectedValue(new Error("no recording"));
    __setSolariModuleLoader(() => Promise.resolve(stubModule(client)));

    const rec = recorder();
    const session = await launchBrowser(opts({ apiKey: "slr_live_x_y", log: rec.log }));

    await expect(session.getReplayUrl()).resolves.toBeUndefined();
    expect(rec.lines.some((l) => l.level === "warn" && /no replay link/i.test(l.message))).toBe(
      true,
    );

    await session.close();
  });

  it("downgrades once on FeatureRequiresPlan, then launches live", async () => {
    const browser = stubBrowser();
    const client = stubClient(browser);
    const err = Object.assign(new Error("stealth requires a paid plan"), {
      code: "FeatureRequiresPlan",
    });
    client.launch.mockRejectedValueOnce(err).mockResolvedValueOnce(browser);
    __setSolariModuleLoader(() => Promise.resolve(stubModule(client)));

    const rec = recorder();
    const session = await launchBrowser(opts({ apiKey: "slr_live_x_y", log: rec.log }));

    expect(client.launch).toHaveBeenCalledTimes(2);
    const secondCallArgs = client.launch.mock.calls[1]?.[0];
    expect(secondCallArgs).not.toHaveProperty("stealth");
    expect(secondCallArgs).not.toHaveProperty("captcha");
    expect(secondCallArgs).not.toHaveProperty("proxy");
    expect(session.mode).toBe("live");

    await session.close();
  });

  it("does not blindly retry a non-downgradeable error; falls back to fixtures", async () => {
    const browser = stubBrowser();
    const client = stubClient(browser);
    const err = Object.assign(new Error("too many concurrent sessions"), {
      code: "ConcurrencyLimitExceeded",
    });
    client.launch.mockRejectedValue(err);
    __setSolariModuleLoader(() => Promise.resolve(stubModule(client)));

    const rec = recorder();
    const session = await launchBrowser(opts({ apiKey: "slr_live_x_y", log: rec.log }));

    expect(client.launch).toHaveBeenCalledTimes(1);
    expect(session.mode).toBe("fixture");
    expect(
      rec.lines.some(
        (l) => l.level === "warn" && /ConcurrencyLimitExceeded/.test(l.message),
      ),
    ).toBe(true);
  });

  it("close() closes the browser and the client, and is idempotent", async () => {
    const browser = stubBrowser();
    const client = stubClient(browser);
    __setSolariModuleLoader(() => Promise.resolve(stubModule(client)));

    const session = await launchBrowser(opts({ apiKey: "slr_live_x_y" }));
    await session.close();
    await session.close();

    expect(browser.close).toHaveBeenCalled();
    expect(client.close).toHaveBeenCalled();
  });
});
