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
  REPLAY_TOO_LARGE,
  type BrowserSession,
  type LaunchOptions,
  type ReplayBytes,
  type ReplayTooLarge,
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
    downloadReplay?: ReturnType<typeof vi.fn>;
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
      downloadReplay: vi.fn().mockResolvedValue(new Uint8Array()),
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

  it("allowLive: false never reaches the live SDK, even with a real-looking key", async () => {
    // Section 1: a run whose LLM is unusable must not open a paid, recorded
    // session just because a Solari key happens to be present.
    const loader = vi.fn(() => Promise.resolve({}));
    __setSolariModuleLoader(loader);
    const rec = recorder();

    const session = await launchBrowser(
      opts({ apiKey: "slr_live_should_be_ignored", allowLive: false, log: rec.log }),
    );

    expect(session).toBeInstanceOf(FixtureBrowserSession);
    expect(session.mode).toBe("fixture");
    expect(loader).not.toHaveBeenCalled();
    expect(rec.lines.some((l) => /live browser disabled/i.test(l.message))).toBe(true);
    await session.close();
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

  it("the DEFAULT loader refuses to reach the network under the test runner", async () => {
    // Guards "zero network calls in tests": `@solarisdk/browser` is a real
    // installed dependency now, and `runJob` reads SOLARI_API_KEY from
    // process.env — so a test that forgets its seam, on a machine with a real
    // key exported, would open a real billable recorded session. The default
    // loader has to fail closed rather than rely on every test remembering.
    __setSolariModuleLoader(); // restore the real one
    const rec = recorder();

    const session = await launchBrowser(
      opts({ apiKey: "slr_live_real_key", log: rec.log }),
    );

    expect(session.mode).toBe("fixture");
    expect(rec.lines.some((l) => /refusing to load the real SDK/i.test(l.message))).toBe(
      true,
    );
    expect(JSON.stringify(rec.lines)).not.toContain("slr_live_real_key");
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

  it("constructs the client with the key and sends the verified launch options", async () => {
    const browser = stubBrowser();
    const client = stubClient(browser);
    const ctorArgs: Array<Record<string, unknown>> = [];
    class Solari {
      sessions = client.sessions;
      launch = client.launch;
      close = client.close;
      constructor(o: Record<string, unknown>) {
        ctorArgs.push(o);
      }
    }
    __setSolariModuleLoader(() => Promise.resolve({ Solari }));

    const session = await launchBrowser(
      opts({
        apiKey: "slr_live_abc_def",
        jobId: "0f8fad5b-d9cb-469f-a165-70867728950e",
        location: { country: "FR" },
      }),
    );

    expect(ctorArgs).toHaveLength(1);
    expect(ctorArgs[0]).toMatchObject({
      apiKey: "slr_live_abc_def",
      timeoutMs: 30_000,
      maxAttempts: 2,
    });

    const launchArgs = client.launch.mock.calls[0]?.[0] as {
      proxy?: { country?: string; session?: string; sessionDuration?: number };
    };
    expect(launchArgs).toMatchObject({
      stealth: true,
      captcha: true,
      recording: true,
    });
    expect(launchArgs.proxy?.country).toBe("fr");
    expect(launchArgs.proxy?.sessionDuration).toBe(15);
    // `ProxyRequest.session` is documented as "alnum + dash, <=32 chars" — a
    // raw 36-char job UUID is rejected by the gateway.
    expect(launchArgs.proxy?.session).toMatch(/^[A-Za-z0-9-]{1,32}$/);

    await session.close();
  });

  it("omits the sticky-session id entirely when nothing usable survives trimming", async () => {
    const browser = stubBrowser();
    const client = stubClient(browser);
    __setSolariModuleLoader(() => Promise.resolve(stubModule(client)));

    const session = await launchBrowser(
      opts({ apiKey: "slr_live_x_y", jobId: "___" }),
    );

    const launchArgs = client.launch.mock.calls[0]?.[0] as {
      proxy?: { session?: string };
    };
    // An empty string is not a valid `ProxyRequest.session`; the field has to
    // be absent rather than blank.
    expect(launchArgs.proxy?.session).toBeUndefined();

    await session.close();
  });

  it("unwraps the replay URL object into { url, expiresAt } the schema requires", async () => {
    const browser = stubBrowser();
    const client = stubClient(browser);
    const before = Date.now();
    client.sessions.getReplayUrl.mockResolvedValue({
      url: "https://replay.example/abc",
      expiresInSeconds: 3600,
      contentEncoding: "gzip",
    });
    __setSolariModuleLoader(() => Promise.resolve(stubModule(client)));

    const session = await launchBrowser(opts({ apiKey: "slr_live_x_y" }));
    const result = await session.getReplayUrl();

    expect(result?.url).toBe("https://replay.example/abc");
    expect(z.array(z.string()).safeParse([result?.url]).success).toBe(true);
    // expiresAt is Date.now() + expiresInSeconds * 1000 at the moment the SDK answered.
    expect(result?.expiresAt).toBeGreaterThanOrEqual(before + 3_600_000);
    expect(result?.expiresAt).toBeLessThan(before + 3_600_000 + 5_000);

    await session.close();
  });

  it("never returns a non-http(s) replay URL, however the gateway answers", async () => {
    // The replay URL is persisted into `replays.replay_url` and rendered as an
    // `href`. A hostile / compromised gateway answering `javascript:…` would
    // otherwise be a stored XSS on the dossier page.
    for (const hostile of [
      "javascript:alert(document.domain)",
      "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
      "file:///etc/passwd",
      "/relative/path",
      "",
    ]) {
      const browser = stubBrowser();
      const client = stubClient(browser);
      client.sessions.getReplayUrl.mockResolvedValue({
        url: hostile,
        expiresInSeconds: 600,
        contentEncoding: "gzip",
      });
      __setSolariModuleLoader(() => Promise.resolve(stubModule(client)));

      const session = await launchBrowser(opts({ apiKey: "slr_live_x_y" }));
      vi.useFakeTimers();
      try {
        const pending = session.getReplayUrl();
        await vi.advanceTimersByTimeAsync(10_000);
        await expect(pending).resolves.toBeUndefined();
      } finally {
        vi.useRealTimers();
      }
      await session.close();
    }
  });

  it("scrubs the key out of the give-up warning, not just at the logger sink", async () => {
    const KEY = "slr_live_LEAKME_0002";
    const browser = stubBrowser();
    const client = stubClient(browser);
    // Third-party SDKs do echo the credential back in error text.
    client.sessions.getReplayUrl.mockRejectedValue(
      new Error(`401 unauthorized for key ${KEY}`),
    );
    __setSolariModuleLoader(() => Promise.resolve(stubModule(client)));

    const rec = recorder();
    const session = await launchBrowser(opts({ apiKey: KEY, log: rec.log }));

    vi.useFakeTimers();
    try {
      const pending = session.getReplayUrl();
      await vi.advanceTimersByTimeAsync(10_000);
      await expect(pending).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }

    expect(JSON.stringify(rec.lines)).not.toContain(KEY);
    expect(
      rec.lines.some((l) => l.level === "warn" && l.message.includes("***")),
    ).toBe(true);

    await session.close();
  });

  it("polls for a replay URL that is not sealed yet, then returns it", async () => {
    // The SDK documents the presigned URL as available only ~1-3s AFTER the
    // session is released, so a single immediate GET misses it.
    const browser = stubBrowser();
    const client = stubClient(browser);
    client.sessions.getReplayUrl
      .mockRejectedValueOnce(new Error("404 replay not ready"))
      .mockResolvedValueOnce({
        url: "https://replay.example/late",
        expiresInSeconds: 900,
        contentEncoding: "gzip",
      });
    __setSolariModuleLoader(() => Promise.resolve(stubModule(client)));

    const session = await launchBrowser(opts({ apiKey: "slr_live_x_y" }));

    vi.useFakeTimers();
    try {
      const pending = session.getReplayUrl();
      await vi.advanceTimersByTimeAsync(10_000);
      await expect(pending).resolves.toMatchObject({
        url: "https://replay.example/late",
      });
    } finally {
      vi.useRealTimers();
    }
    expect(client.sessions.getReplayUrl).toHaveBeenCalledTimes(2);

    await session.close();
  });

  it("getReplayUrl rejects every attempt -> undefined, a warning naming the cause, never throws", async () => {
    const browser = stubBrowser();
    const client = stubClient(browser);
    client.sessions.getReplayUrl.mockRejectedValue(
      new Error("recording is not enabled on this plan"),
    );
    __setSolariModuleLoader(() => Promise.resolve(stubModule(client)));

    const rec = recorder();
    const session = await launchBrowser(opts({ apiKey: "slr_live_x_y", log: rec.log }));

    vi.useFakeTimers();
    try {
      const pending = session.getReplayUrl();
      await vi.advanceTimersByTimeAsync(10_000);
      await expect(pending).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }

    const warning = rec.lines.find(
      (l) => l.level === "warn" && /no replay link/i.test(l.message),
    );
    expect(warning).toBeDefined();
    // The give-up line has to say WHY — "no replay link" alone is unusable
    // when the real cause is a gateway error rather than a plan limit.
    expect(warning?.message).toMatch(/not enabled on this plan/);
    // Bounded: the first attempt plus the two retries, never an open loop.
    expect(client.sessions.getReplayUrl).toHaveBeenCalledTimes(3);

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
    // recording is not in the SDK's plan-gated feature list — keep it on
    expect(secondCallArgs).toMatchObject({ recording: true });
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

  it("releases the session before asking for the replay URL; a later close() does not repeat it", async () => {
    // The runner's real sequence (`runner.ts` finally-block): getReplayUrl()
    // then close(). The replay URL is only minted after the session is
    // released, so the session object has to release on the first of the two
    // and must not release/close twice on the second.
    const browser = stubBrowser({ id: "sess-order" });
    const client = stubClient(browser);
    const order: string[] = [];
    // The real SDK's `BrowserSession.close()` releases the Solari-side session
    // itself ("Close the browser and release the session. Idempotent."), so
    // the stub has to do that too or this test would license a redundant
    // second DELETE on every live session.
    browser.close.mockImplementation(() => {
      order.push("browser.close");
      return client.sessions.releaseAndWait("sess-order");
    });
    client.sessions.releaseAndWait.mockImplementation(() => {
      order.push("releaseAndWait");
      return Promise.resolve();
    });
    client.sessions.getReplayUrl.mockImplementation(() => {
      order.push("getReplayUrl");
      return Promise.resolve({
        url: "https://replay.example/ordered",
        expiresInSeconds: 600,
        contentEncoding: "gzip",
      });
    });
    __setSolariModuleLoader(() => Promise.resolve(stubModule(client)));

    const session = await launchBrowser(opts({ apiKey: "slr_live_x_y" }));
    expect((await session.getReplayUrl())?.url).toBe(
      "https://replay.example/ordered",
    );
    await session.close();

    expect(order).toEqual(["browser.close", "releaseAndWait", "getReplayUrl"]);
    expect(browser.close).toHaveBeenCalledTimes(1);
    // Exactly once — the one the SDK itself made, not a second one of ours.
    expect(client.sessions.releaseAndWait).toHaveBeenCalledTimes(1);
    expect(client.sessions.releaseAndWait).toHaveBeenCalledWith("sess-order");
    expect(client.close).toHaveBeenCalledTimes(1);
  });

  it("releases the session itself when the SDK's browser.close() fails", async () => {
    const browser = stubBrowser({ id: "sess-stuck" });
    const client = stubClient(browser);
    browser.close.mockRejectedValue(new Error("browser already gone"));
    __setSolariModuleLoader(() => Promise.resolve(stubModule(client)));

    const session = await launchBrowser(opts({ apiKey: "slr_live_x_y" }));
    await session.close();

    // A failed browser.close() may not have released the pool slot; the
    // fallback DELETE is what keeps the session from being orphaned.
    expect(client.sessions.releaseAndWait).toHaveBeenCalledWith("sess-stuck");
    expect(client.close).toHaveBeenCalledTimes(1);
  });

  it("closes the client when the launch fails, instead of leaking it", async () => {
    // The client starts a local proxy server as soon as a session is created,
    // so a launch that fails after that point leaks a listening socket for the
    // life of this long-running worker unless the client is closed.
    const browser = stubBrowser();
    const client = stubClient(browser);
    client.launch.mockRejectedValue(
      Object.assign(new Error("browser did not come up"), {
        code: "BrowserUnhealthy",
      }),
    );
    __setSolariModuleLoader(() => Promise.resolve(stubModule(client)));

    const session = await launchBrowser(opts({ apiKey: "slr_live_x_y" }));

    expect(session.mode).toBe("fixture");
    expect(client.close).toHaveBeenCalledTimes(1);
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

/** Narrow a `downloadReplay` result to its bytes branch. The `too_large`
 *  sentinel is a separate outcome with its own test below — asserting it away
 *  here keeps these three about the bytes. */
function expectBytes(
  result: ReplayBytes | ReplayTooLarge | undefined,
): ReplayBytes {
  expect(result).toBeDefined();
  expect(result).not.toBe(REPLAY_TOO_LARGE);
  return result as ReplayBytes;
}

describe("downloadReplay — live Solari client (stubbed, zero network)", () => {
  it("sniffs the gzip magic bytes rather than trusting a header", async () => {
    const browser = stubBrowser();
    const client = stubClient(browser);
    client.sessions.downloadReplay.mockResolvedValue(
      new Uint8Array([0x1f, 0x8b, 1, 2, 3]),
    );
    __setSolariModuleLoader(() => Promise.resolve(stubModule(client)));

    const session = await launchBrowser(opts({ apiKey: "slr_live_x_y" }));
    const result = await session.downloadReplay(1024);

    const bytes = expectBytes(result);
    expect(bytes.gzipped).toBe(true);
    expect(bytes.bytes.byteLength).toBe(5);

    await session.close();
  });

  it("reports gzipped: false for plain NDJSON bytes", async () => {
    // undici auto-decompresses a `Content-Encoding: gzip` response, so the
    // SDK's `downloadReplay()` may hand back plain bytes even though the
    // upstream object was stored gzipped.
    const browser = stubBrowser();
    const client = stubClient(browser);
    const ndjson = new TextEncoder().encode('{"type":"nav"}\n');
    client.sessions.downloadReplay.mockResolvedValue(ndjson);
    __setSolariModuleLoader(() => Promise.resolve(stubModule(client)));

    const session = await launchBrowser(opts({ apiKey: "slr_live_x_y" }));
    const result = await session.downloadReplay(1024);

    const bytes = expectBytes(result);
    expect(bytes.gzipped).toBe(false);
    expect(bytes.bytes).toEqual(ndjson);

    await session.close();
  });

  it("returns a zero-length ReplayBytes for a genuinely empty recording", async () => {
    const browser = stubBrowser();
    const client = stubClient(browser);
    client.sessions.downloadReplay.mockResolvedValue(new Uint8Array());
    __setSolariModuleLoader(() => Promise.resolve(stubModule(client)));

    const session = await launchBrowser(opts({ apiKey: "slr_live_x_y" }));
    const result = await session.downloadReplay(1024);

    expect(expectBytes(result).bytes.byteLength).toBe(0);

    await session.close();
  });

  it("a buffer over the cap reports too_large — not undefined — without echoing the URL", async () => {
    const browser = stubBrowser();
    const client = stubClient(browser);
    client.sessions.downloadReplay.mockResolvedValue(new Uint8Array(2048));
    __setSolariModuleLoader(() => Promise.resolve(stubModule(client)));

    const rec = recorder();
    const session = await launchBrowser(opts({ apiKey: "slr_live_x_y", log: rec.log }));
    const result = await session.downloadReplay(1024);

    // `undefined` here would be indistinguishable from "no recording on this
    // plan" and would surface in the dossier as "no replay available".
    expect(result).toBe(REPLAY_TOO_LARGE);
    expect(rec.lines.some((l) => l.level === "warn" && /too large/i.test(l.message))).toBe(
      true,
    );

    await session.close();
  });

  it("a throwing SDK returns undefined and never propagates, key never echoed", async () => {
    const KEY = "slr_live_LEAKME_0003";
    const browser = stubBrowser();
    const client = stubClient(browser);
    client.sessions.downloadReplay.mockRejectedValue(
      new Error(`fetch failed for key ${KEY}`),
    );
    __setSolariModuleLoader(() => Promise.resolve(stubModule(client)));

    const rec = recorder();
    const session = await launchBrowser(opts({ apiKey: KEY, log: rec.log }));

    await expect(session.downloadReplay(1024)).resolves.toBeUndefined();
    expect(JSON.stringify(rec.lines)).not.toContain(KEY);
    expect(
      rec.lines.some((l) => l.level === "warn" && /download failed/i.test(l.message)),
    ).toBe(true);

    await session.close();
  });

  it("returns undefined for a fixture session", async () => {
    const session = await launchBrowser(opts());
    expect(session.mode).toBe("fixture");
    await expect(session.downloadReplay(1024)).resolves.toBeUndefined();
    await session.close();
  });
});
