// All Solari access lives behind `BrowserSession`. The real client is loaded by
// a DYNAMIC import (never a static one) so nothing in the repo is blocked on the
// `@solarisdk/browser` package existing or a key being present. Any failure —
// missing module, missing key, a Starter plan rejecting an option — degrades to
// `FixtureBrowserSession`, never crashes.
import { proxyCountryFrom, type Location } from "@sensitiv/shared";
import { FixtureBrowserSession } from "./fixture.ts";
import type { JobLogLevel } from "../logger.ts";
import { describeError } from "../util.ts";
import type {
  Solari as SolariSdk,
  LaunchOptions as SolariLaunchOptions,
  ReplayUrl as SolariReplayUrl,
} from "@solarisdk/browser";

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

/** Test seam: swap out the dynamic import so a test can drive the live path
 *  with a stub module and zero network. */
export type SolariModuleLoader = () => Promise<unknown>;
let loadSolariModule: SolariModuleLoader = () =>
  import(SOLARI_MODULE as string);
/** Test seam only. Pass nothing to restore the real dynamic import. */
export function __setSolariModuleLoader(loader?: SolariModuleLoader): void {
  loadSolariModule = loader ?? (() => import(SOLARI_MODULE as string));
}

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

// --- real client (verified against @solarisdk/browser@0.1.4; never statically
// imported — only `import type`, which is erased at runtime) --------------

// The SDK exports `BrowserSession` and `LaunchOptions`, names our own local
// interfaces above already claim — alias everything from the module shape.
interface SolariModule {
  Solari?: new (opts: {
    apiKey: string;
    timeoutMs?: number;
    maxAttempts?: number;
  }) => SolariSdk;
}

/** Solari's sticky-session id is documented as "alnum + dash, <=32 chars"
 *  (`ProxyRequest.session`). A job id is a 36-char `randomUUID()`, which the
 *  gateway rejects — trim it to the documented shape. The leading 32 chars of a
 *  UUID are still unique enough to pin one egress IP per job. */
function stickySessionId(jobId: string): string {
  return jobId.replace(/[^A-Za-z0-9-]/g, "").slice(0, 32);
}

async function launchSolari(
  apiKey: string,
  opts: LaunchOptions,
): Promise<BrowserSession> {
  const mod = (await loadSolariModule()) as SolariModule;

  if (typeof mod.Solari !== "function") {
    throw new Error("@solarisdk/browser: no Solari export found on module");
  }
  // Conservative timeout so a bad key fails fast instead of hanging a job.
  const client = new mod.Solari({ apiKey, timeoutMs: 30_000, maxAttempts: 2 });

  const proxyCountry = proxyCountryFrom(opts.location);
  const full: SolariLaunchOptions = {
    stealth: true,
    captcha: true,
    recording: true,
    proxy: {
      country: proxyCountry,
      session: stickySessionId(opts.jobId),
      sessionDuration: 15,
    },
  };

  let browser: Awaited<ReturnType<SolariSdk["launch"]>>;
  try {
    browser = await client.launch(full);
  } catch (err) {
    // Only `FeatureRequiresPlan` (stealth / proxy / captcha not on the plan) is
    // a downgradeable signal. Everything else — concurrency limits, plan
    // limits, an unhealthy browser, a bad session id — is not worth retrying;
    // rethrow so the outer catch falls back to fixtures.
    const code = (err as { code?: unknown }).code;
    if (code !== "FeatureRequiresPlan") {
      throw new Error(
        `Solari launch failed (${String(code ?? "unknown")}): ${describeError(err, apiKey)}`,
      );
    }
    await opts.log(
      "warn",
      `Solari plan rejected an option (${describeError(err, apiKey)}) — retrying without stealth/captcha/proxy`,
    );
    // Recording is not plan-gated per the docs; keep it on the retry.
    browser = await client.launch({ recording: true });
  }

  return new SolariBrowserSession(client, browser, opts.log);
}

class SolariBrowserSession implements BrowserSession {
  readonly mode = "live" as const;
  readonly sessionId: string;
  #client: SolariSdk;
  #browser: Awaited<ReturnType<SolariSdk["launch"]>>;
  #log: (level: JobLogLevel, message: string) => Promise<void>;
  #released = false;
  #closed = false;

  constructor(
    client: SolariSdk,
    browser: Awaited<ReturnType<SolariSdk["launch"]>>,
    log: (level: JobLogLevel, message: string) => Promise<void>,
  ) {
    this.#client = client;
    this.#browser = browser;
    this.sessionId = browser.id || `solari-${Date.now().toString(36)}`;
    this.#log = log;
  }

  async newPage(): Promise<BrowserPage> {
    return wrapPage(await this.#browser.newPage());
  }

  /** Idempotent: closes the browser and releases the session on Solari's side.
   *  Does NOT tear down the client — `getReplayUrl()` needs it first, and
   *  `close()` does that after. */
  async #ensureReleased(): Promise<void> {
    if (this.#released) return;
    this.#released = true;
    try {
      await this.#browser.close();
    } catch {
      /* an already-dead session is fine */
    }
    try {
      await this.#client.sessions.releaseAndWait(this.sessionId);
    } catch {
      /* best-effort — the session may already be released */
    }
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    await this.#ensureReleased();
    try {
      await this.#client.close();
    } catch {
      /* an already-closed client is fine */
    }
  }

  async getReplayUrl(): Promise<string | undefined> {
    await this.#ensureReleased();
    try {
      const replay: SolariReplayUrl = await this.#client.sessions.getReplayUrl(
        this.sessionId,
      );
      const url = replay?.url;
      if (typeof url !== "string" || url.length === 0) {
        await this.#log(
          "warn",
          "recording unavailable on this plan — no replay link",
        );
        return undefined;
      }
      await this.#log(
        "info",
        `replay link ready (expires in ${replay.expiresInSeconds}s)`,
      );
      return url;
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
