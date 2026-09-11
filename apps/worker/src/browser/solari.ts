// All Solari access lives behind `BrowserSession`. The real client is loaded by
// a DYNAMIC import (never a static one) so nothing in the repo is blocked on the
// `@solarisdk/browser` package existing or a key being present. Any failure —
// missing module, missing key, a Starter plan rejecting an option — degrades to
// `FixtureBrowserSession`, never crashes.
import { proxyCountryFrom, type Location } from "@sensitiv/shared";
import { FixtureBrowserSession } from "./fixture.ts";
import type { JobLogLevel } from "../logger.ts";
import { describeError, sleep } from "../util.ts";
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

/** A presigned replay URL plus its expiry, so callers can persist and later
 *  render an honest "expires <time>" / "this link has expired" instead of a
 *  dead link that just fails silently. */
export interface ReplayUrlResult {
  url: string;
  /** Unix ms. */
  expiresAt: number;
}

export interface ReplayBytes {
  bytes: Uint8Array;
  /** true when `bytes` still carry the gzip magic (0x1f 0x8b). Node's `fetch`
   *  (undici) auto-decompresses a `Content-Encoding: gzip` response, so the
   *  SDK's `downloadReplay()` may hand back either gzip bytes or plain NDJSON
   *  — sniff, never trust the header. */
  gzipped: boolean;
}

export interface BrowserSession {
  readonly sessionId: string;
  readonly mode: "live" | "fixture";
  newPage(): Promise<BrowserPage>;
  close(): Promise<void>;
  /** The private replay URL and its expiry, or `undefined` (no recording on
   *  this plan / fixtures). A recording is only sealed once the session is
   *  released, so calling this ENDS the session: no page survives it. Call it
   *  last, then `close()`. */
  getReplayUrl(): Promise<ReplayUrlResult | undefined>;
  /** The recording itself, fetched while the presigned link is still valid.
   *  `undefined` on the fixture path, on a plan without recording, or on any
   *  gateway failure. Best-effort: never throws. A buffer over `maxBytes`
   *  also returns `undefined` (the caller records that as `too_large`); a
   *  genuinely empty recording returns a zero-length `ReplayBytes` so the
   *  caller can tell "empty" apart from "unavailable". */
  downloadReplay(maxBytes: number): Promise<ReplayBytes | undefined>;
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
  /** When false, never reach the live SDK even with a key — the caller has
   *  decided this run cannot produce real results (e.g. no working LLM).
   *  Defaults to true so existing callers are unchanged. */
  allowLive?: boolean;
}

const SOLARI_MODULE = "@solarisdk/browser";

/** Test seam: swap out the dynamic import so a test can drive the live path
 *  with a stub module and zero network. */
export type SolariModuleLoader = () => Promise<unknown>;

/** The real dynamic import — plus a hard stop under the test runner.
 *
 *  `@solarisdk/browser` is now a real installed dependency, so this import
 *  resolves, and `runJob` reads `SOLARI_API_KEY` straight from `process.env`.
 *  A developer (or CI) with that variable exported would therefore have any
 *  test that forgot to inject a `browserFactory` or a loader open a REAL,
 *  billable, recorded Solari session with a REAL key. "Zero network calls in
 *  tests" (memory/running-and-testing.md) is too important to leave to
 *  per-test discipline — enforce it here, at the one place that can reach the
 *  network. `launchBrowser` catches this and degrades to fixtures, exactly as
 *  it would for a missing module. */
function importSolari(): Promise<unknown> {
  if (process.env.VITEST || process.env.NODE_ENV === "test") {
    return Promise.reject(
      new Error(
        "@solarisdk/browser: refusing to load the real SDK under the test runner — " +
          "inject a stub with __setSolariModuleLoader() or pass a browserFactory",
      ),
    );
  }
  return import(SOLARI_MODULE as string);
}

let loadSolariModule: SolariModuleLoader = importSolari;
/** Test seam only. Pass nothing to restore the real dynamic import. */
export function __setSolariModuleLoader(loader?: SolariModuleLoader): void {
  loadSolariModule = loader ?? importSolari;
}

export async function launchBrowser(
  opts: LaunchOptions,
): Promise<BrowserSession> {
  if (opts.factory) return opts.factory(opts);

  if (opts.allowLive === false) {
    await opts.log("info", "live browser disabled for this run — running against fixtures");
    return new FixtureBrowserSession(opts.fixture);
  }

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
 *  UUID are still unique enough to pin one egress IP per job. Returns
 *  `undefined` when nothing usable survives, so the field is omitted rather
 *  than sent empty. */
function stickySessionId(jobId: string): string | undefined {
  return jobId.replace(/[^A-Za-z0-9-]/g, "").slice(0, 32) || undefined;
}

/** The gateway seals the recording as the session is released and the SDK
 *  documents the presigned URL as "available ~1-3s after `releaseAndWait`", so
 *  a single immediate GET reliably misses it. Poll across that window before
 *  giving up. The cost is paid only when the URL is NOT there — i.e. once per
 *  session on a plan without recording — so keep the total short. */
const REPLAY_RETRY_DELAYS_MS = [700, 1800] as const;

/** The replay URL is third-party output: it comes back from the Solari gateway,
 *  is persisted verbatim into `replays.replay_url` and the web UI turns it into
 *  an `href`. `DossierReplaySchema.url` is a bare `z.string().optional()`, so a
 *  hostile or compromised gateway response (or a typosquatted SDK) returning
 *  `javascript:…` would otherwise become a stored, click-to-run XSS on the
 *  dossier page. Constrain it to absolute http(s) here so nothing else ever
 *  sees one — `safeExternalHref()` in the UI is the second gate. */
function safeReplayUrl(raw: unknown): string | undefined {
  if (typeof raw !== "string" || raw.length === 0) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return undefined;
  }
  return parsed.protocol === "https:" || parsed.protocol === "http:"
    ? parsed.href
    : undefined;
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

  try {
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

    // From here the session owns the client and closes it in `close()`.
    return new SolariBrowserSession(client, browser, opts.log, apiKey);
  } catch (err) {
    // A failed launch still leaves the client holding resources: it starts a
    // local proxy server the moment a session is created, so a launch that
    // creates a session and then fails to connect leaks a listening socket for
    // the life of this long-running worker process unless we close it here.
    await closeQuietly(client);
    throw err;
  }
}

async function closeQuietly(client: SolariSdk): Promise<void> {
  try {
    await client.close();
  } catch {
    /* an already-closed client is fine */
  }
}

class SolariBrowserSession implements BrowserSession {
  readonly mode = "live" as const;
  readonly sessionId: string;
  #client: SolariSdk;
  #browser: Awaited<ReturnType<SolariSdk["launch"]>>;
  #log: (level: JobLogLevel, message: string) => Promise<void>;
  #released = false;
  #closed = false;
  /** The id Solari itself knows the session by, or `""` if the SDK handed us
   *  none. Never the synthetic fallback — that one is ours, for logs and the
   *  `replays` row, and sending it to the API would address a session that
   *  does not exist. */
  #solariId: string;
  /** Held for redaction only — never sent anywhere but the SDK, which already
   *  has it. `describeError(err, this.#apiKey)` is belt-and-braces on top of
   *  the sink-level scrub in `createJobLogger`, because `launchBrowser` is
   *  exported and a caller can supply a `log` that does not scrub. Lives
   *  exactly as long as the session. */
  #apiKey: string;

  constructor(
    client: SolariSdk,
    browser: Awaited<ReturnType<SolariSdk["launch"]>>,
    log: (level: JobLogLevel, message: string) => Promise<void>,
    apiKey: string,
  ) {
    this.#client = client;
    this.#browser = browser;
    this.#solariId = typeof browser.id === "string" ? browser.id : "";
    this.sessionId = this.#solariId || `solari-${Date.now().toString(36)}`;
    this.#log = log;
    this.#apiKey = apiKey;
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
    let browserClosed = false;
    try {
      // The SDK's own `close()` releases the Solari-side session too, so this
      // one call is normally the whole teardown.
      await this.#browser.close();
      browserClosed = true;
    } catch {
      /* an already-dead session is fine */
    }
    // Only when that threw do we still owe the gateway a release — otherwise
    // this would be a second, redundant DELETE on every single session.
    if (!browserClosed && this.#solariId) {
      try {
        await this.#client.sessions.releaseAndWait(this.#solariId);
      } catch {
        /* best-effort — the session may already be released */
      }
    }
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    await this.#ensureReleased();
    await closeQuietly(this.#client);
  }

  async getReplayUrl(): Promise<ReplayUrlResult | undefined> {
    await this.#ensureReleased();
    if (!this.#solariId) return undefined;

    let lastErr: unknown;
    for (let attempt = 0; ; attempt++) {
      try {
        const replay: SolariReplayUrl =
          await this.#client.sessions.getReplayUrl(this.#solariId);
        const url = safeReplayUrl(replay?.url);
        if (url) {
          // The URL itself is a presigned bearer capability — log the expiry,
          // never the link.
          await this.#log(
            "info",
            `replay link ready (expires in ${replay.expiresInSeconds}s)`,
          );
          return { url, expiresAt: Date.now() + replay.expiresInSeconds * 1000 };
        }
        lastErr = new Error(
          "replay response carried no usable http(s) url",
        );
      } catch (err) {
        lastErr = err;
      }
      const delay = REPLAY_RETRY_DELAYS_MS[attempt];
      if (delay === undefined) break;
      await sleep(delay);
    }
    // Naming the cause matters: "not on this plan" and "not sealed yet" and
    // "the gateway is down" all land here and only the error text tells them
    // apart. The text is a third-party SDK's, so scrub the key out of it here
    // as well as at the logger sink.
    await this.#log(
      "warn",
      `no replay link (${describeError(lastErr, this.#apiKey)}) — recording may be off on this plan`,
    );
    return undefined;
  }

  /** Best-effort: never throws. `maxBytes` guards against holding an
   *  unbounded recording in worker memory; a buffer over the cap is dropped
   *  (the caller records `too_large`) rather than written to disk. */
  async downloadReplay(maxBytes: number): Promise<ReplayBytes | undefined> {
    await this.#ensureReleased();
    if (!this.#solariId) return undefined;
    try {
      const bytes = await this.#client.sessions.downloadReplay(this.#solariId);
      if (bytes.byteLength > maxBytes) {
        await this.#log(
          "warn",
          `replay too large to store (${bytes.byteLength} bytes > ${maxBytes} cap)`,
        );
        return undefined;
      }
      const gzipped = bytes[0] === 0x1f && bytes[1] === 0x8b;
      return { bytes, gzipped };
    } catch (err) {
      // Never log the URL — this is the download that follows it, and the
      // only replay-URL-adjacent line allowed is the expiry one above.
      await this.#log(
        "warn",
        `replay download failed (${describeError(err, this.#apiKey)})`,
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
