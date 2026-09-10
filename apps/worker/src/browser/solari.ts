// All Solari access lives behind `BrowserSession`. The real client is loaded by
// a DYNAMIC import (never a static one) so nothing in the repo is blocked on the
// `@solarisdk/browser` package existing or a key being present. Any failure —
// missing module, missing key, a Starter plan rejecting an option — degrades to
// `FixtureBrowserSession`, never crashes.
import { proxyCountryFrom, type Location } from "@sensitiv/shared";
import { FixtureBrowserSession } from "./fixture.ts";
import type { JobLogLevel } from "../logger.ts";
import { describeError } from "../util.ts";

/** A minimal Playwright-compatible page surface — all the adapters need. */
export interface BrowserPage {
  goto(
    url: string,
    opts?: { waitUntil?: string; timeout?: number },
  ): Promise<void>;
  waitForTimeout(ms: number): Promise<void>;
  evaluate<T>(fn: string | ((...args: unknown[]) => T)): Promise<T>;
  content(): Promise<string>;
  close(): Promise<void>;
}

export interface BrowserSession {
  readonly sessionId: string;
  readonly mode: "live" | "fixture";
  newPage(): Promise<BrowserPage>;
  close(): Promise<void>;
  /** The private replay URL, or `undefined` (no recording on this plan / fixtures). */
  getReplayUrl(): Promise<string | undefined>;
}

export interface LaunchOptions {
  jobId: string;
  location: Pick<Location, "country">;
  /** BYOK or env key. Held in memory only; NEVER logged or persisted. */
  apiKey?: string;
  log: (level: JobLogLevel, message: string) => Promise<void>;
  /** Test seam: forces a specific session and skips all Solari plumbing. */
  factory?: (opts: LaunchOptions) => Promise<BrowserSession>;
  /** Payload handed to `FixtureBrowserSession` on the fixture path. */
  fixture?: unknown;
}

const SOLARI_MODULE = "@solarisdk/browser";

export async function launchBrowser(
  opts: LaunchOptions,
): Promise<BrowserSession> {
  if (opts.factory) return opts.factory(opts);

  const apiKey = opts.apiKey?.trim();
  if (!apiKey) {
    await opts.log("info", "no Solari key — running against fixtures");
    return new FixtureBrowserSession(opts.fixture);
  }

  try {
    return await launchSolari(apiKey, opts);
  } catch (err) {
    await opts.log(
      "warn",
      `Solari unavailable (${describeError(err, apiKey)}) — falling back to fixtures`,
    );
    return new FixtureBrowserSession(opts.fixture);
  }
}

// --- real client (speculative SDK shape; never statically imported) -----------

interface SolariModule {
  createClient?: (opts: { apiKey: string }) => SolariClient;
  Solari?: new (opts: { apiKey: string }) => SolariClient;
  default?: { createClient?: (opts: { apiKey: string }) => SolariClient };
}
interface SolariClient {
  launch(opts: Record<string, unknown>): Promise<SolariBrowser>;
  sessions?: { getReplayUrl(sessionId: string): Promise<string | undefined> };
}
interface SolariBrowser {
  sessionId?: string;
  id?: string;
  newPage(): Promise<unknown>;
  close(): Promise<void>;
}

async function launchSolari(
  apiKey: string,
  opts: LaunchOptions,
): Promise<BrowserSession> {
  // Non-literal specifier: keeps `tsc` from trying to resolve a module that may
  // not be installed. Typed as `unknown` and narrowed below.
  const specifier: string = SOLARI_MODULE;
  const mod = (await import(specifier)) as SolariModule;

  const createClient =
    mod.createClient ?? mod.default?.createClient ?? undefined;
  const client: SolariClient = createClient
    ? createClient({ apiKey })
    : mod.Solari
      ? new mod.Solari({ apiKey })
      : (() => {
          throw new Error("@solarisdk/browser: no known client constructor");
        })();

  const proxyCountry = proxyCountryFrom(opts.location);
  const full: Record<string, unknown> = {
    stealth: true,
    captcha: true,
    recording: true,
    proxy: { country: proxyCountry, session: opts.jobId, sessionDuration: 15 },
  };

  let browser: SolariBrowser;
  try {
    browser = await client.launch(full);
  } catch (err) {
    // Starter plan: an option was rejected. Retry once with nothing fancy.
    await opts.log(
      "warn",
      `Solari plan rejected an option (${describeError(err, apiKey)}) — retrying without stealth/captcha/recording/proxy`,
    );
    browser = await client.launch({});
  }

  return new SolariBrowserSession(client, browser, opts.log);
}

class SolariBrowserSession implements BrowserSession {
  readonly mode = "live" as const;
  readonly sessionId: string;
  #client: SolariClient;
  #browser: SolariBrowser;
  #log: (level: JobLogLevel, message: string) => Promise<void>;

  constructor(
    client: SolariClient,
    browser: SolariBrowser,
    log: (level: JobLogLevel, message: string) => Promise<void>,
  ) {
    this.#client = client;
    this.#browser = browser;
    this.sessionId =
      browser.sessionId ?? browser.id ?? `solari-${Date.now().toString(36)}`;
    this.#log = log;
  }

  async newPage(): Promise<BrowserPage> {
    return wrapPage(await this.#browser.newPage());
  }

  async close(): Promise<void> {
    try {
      await this.#browser.close();
    } catch {
      /* an already-dead session is fine */
    }
  }

  async getReplayUrl(): Promise<string | undefined> {
    try {
      const url = await this.#client.sessions?.getReplayUrl(this.sessionId);
      if (!url) {
        await this.#log(
          "warn",
          "recording unavailable on this plan — no replay link",
        );
      }
      return url ?? undefined;
    } catch {
      await this.#log(
        "warn",
        "recording unavailable on this plan — no replay link",
      );
      return undefined;
    }
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function wrapPage(raw: unknown): BrowserPage {
  const p = raw as any;
  return {
    goto: (url, o) => p.goto(url, o),
    waitForTimeout: (ms) =>
      typeof p.waitForTimeout === "function"
        ? p.waitForTimeout(ms)
        : new Promise((r) => setTimeout(r, ms)),
    evaluate: (fn) => p.evaluate(fn),
    content: () => p.content(),
    close: () => p.close(),
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
