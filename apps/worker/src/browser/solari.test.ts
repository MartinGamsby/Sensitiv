// Acceptance gate (a), adapter half: with an EMPTY `.env` every adapter still
// gets a browser. `launchBrowser` must degrade to `FixtureBrowserSession` —
// never throw, never wait on a network, never echo the key it was handed.
import { describe, expect, it } from "vitest";
import { launchBrowser, type BrowserSession, type LaunchOptions } from "./solari.ts";
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

  it("degrades to fixtures when @solarisdk/browser is not installed, without echoing the key", async () => {
    const KEY = "solari-live-LEAKME-0001";
    const rec = recorder();

    const session = await launchBrowser(opts({ apiKey: KEY, log: rec.log }));

    expect(session.mode).toBe("fixture");
    const warnings = rec.lines.filter((l) => l.level === "warn");
    expect(warnings.some((l) => /falling back to fixtures/i.test(l.message))).toBe(true);
    expect(JSON.stringify(rec.lines)).not.toContain(KEY);
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
