// runJob — the locked agent loop. Load job -> defaults -> location -> search
// language -> planner -> union adapters (cap 3 browsers) -> per adapter a
// browser session -> search -> extract -> Zod -> evidence -> merge -> score ->
// dossier -> attach replay URLs. Stops at the timeout with status = "partial".
// Every numbered step emits at least one job_events row (in the UI locale) so
// the run page reads like a narrative.
import {
  finishJob,
  getJobById,
  getUser,
  markJobRunning,
  setJobSourceModes,
  type DbHandle,
  type Job,
} from "@sensitiv/db";
import {
  resolveSearchLanguage,
  type PlannedRequirement,
  type SearchLanguage,
  type SourceMode,
} from "@sensitiv/shared";
import { loadEnv } from "@sensitiv/shared/env";
import {
  adapterIdsFor,
  getIntent,
  isValidRequirementId,
} from "@sensitiv/shared/catalog/index";
import { plan, type SearchQuery } from "@sensitiv/shared/planner";
import { createLlmProvider, type LlmProvider } from "@sensitiv/shared/llm";
import { createDefaultRegistry } from "./adapters/index.ts";
import type { Adapter, PlaceFinding } from "./adapters/types.ts";
import { FixtureBrowserSession } from "./browser/fixture.ts";
import {
  launchBrowser,
  REPLAY_TOO_LARGE,
  type BrowserSession,
  type LaunchOptions,
} from "./browser/solari.ts";
import { writeDossier, type DossierReplay } from "./dossier.ts";
import { createJobLogger, type JobLogger } from "./logger.ts";
import { mergeFindings } from "./merge.ts";
import { REPLAY_MAX_BYTES, storeReplay } from "./replay-store.ts";
import { JobBudget } from "./timeout.ts";
import {
  dedupe,
  describeError,
  isAbortError,
  scrubSecrets,
  truncate,
} from "./util.ts";

export const MAX_CONCURRENT_BROWSERS = 3;
const DEFAULT_DRAIN_MS = 400;
/** `error_text` is rendered in the UI — long enough to diagnose, bounded anyway. */
const MAX_ERROR_TEXT = 2_000;

export interface RunJobDeps {
  registry?: ReturnType<typeof createDefaultRegistry>;
  llm?: LlmProvider;
  /** BYOK Solari key — memory only, this job only. Never logged, never persisted. */
  solariKey?: string;
  browserFactory?: (opts: LaunchOptions) => Promise<BrowserSession>;
  logger?: JobLogger;
  logSink?: (line: string) => void;
  /** Override `job.timeoutSec` (tests use a fraction of a second). */
  timeoutSec?: number;
  drainMs?: number;
}

export interface RunJobOutcome {
  status: "done" | "partial" | "error";
  placeCount: number;
  evidenceCount: number;
  events: number;
}

export async function runJob(
  db: DbHandle,
  jobId: string,
  deps: RunJobDeps = {},
): Promise<RunJobOutcome> {
  const env = loadEnv();
  // Every secret this run can touch. Adapters and third-party SDKs raise errors
  // we do not control the text of, and those errors are logged into
  // `job_events` (streamed to the browser) and `jobs.error_text` (rendered in
  // the UI) — so the scrub list is threaded into the logger sink and applied to
  // `error_text` below, rather than trusted to each call site.
  const secrets: readonly (string | undefined)[] = [
    deps.solariKey,
    env.SOLARI_API_KEY,
    env.ANTHROPIC_API_KEY,
  ];
  const log =
    deps.logger ??
    createJobLogger(db, jobId, { sink: deps.logSink, redact: secrets });
  const registry = deps.registry ?? createDefaultRegistry();
  const llm = deps.llm ?? createLlmProvider(env, { warn: () => undefined });

  const job = await getJobById(db, jobId);
  if (!job) throw new Error(`runJob: job ${jobId} not found`);

  await markJobRunning(db, jobId);
  await log("info", `job started — "${truncate(job.requestText, 120)}"`);

  const budgetSec =
    deps.timeoutSec ?? (job.timeoutSec > 0 ? job.timeoutSec : env.DEFAULT_JOB_TIMEOUT_SEC);
  const budget = new JobBudget(budgetSec);
  const replays: DossierReplay[] = [];
  let findings: PlaceFinding[] = [];
  let timedOut = false;
  // Keyed by adapter id + the reserved "llm" key — the actual provider/browser
  // mode that ran this job, persisted alongside the dossier so a reopened run
  // stays marked "sample data" regardless of the current `.env`. Declared
  // outside the try so the timeout branch in the `catch` below can persist
  // whatever was recorded before the abort.
  const sourceModes: Record<string, SourceMode> = {};

  try {
    // 1. user defaults
    const user = await getUser(db, job.userId);
    await log(
      "info",
      `loaded defaults for ${user?.email ?? "unknown user"} (ui ${job.uiLocale}, budget ${budgetSec}s)`,
    );

    // 2. location
    await log("info", `location: ${job.location.query}${job.location.postalCode ? ` (${job.location.postalCode})` : ""}`);

    // 3. search language
    const searchLang: SearchLanguage =
      job.searchLang && job.searchLang.toLowerCase() !== "auto"
        ? { code: job.searchLang, source: "user" }
        : resolveSearchLanguage(job.location, user?.defaultSearchLang ?? null);
    await log("info", `search language: ${searchLang.code} (${searchLang.source})`);

    // 4. planner
    const chipIds = job.requirements
      .map((r) => r.catalogId ?? r.id)
      .filter((id) => isValidRequirementId(id));
    const planResult = await plan({
      requestText: job.requestText,
      chipIds,
      extras: collectExtras(job.requirements),
      location: job.location,
      searchLang,
      uiLocale: job.uiLocale,
      provider: llm,
      signal: budget.signal,
    });
    for (const warning of planResult.warnings) {
      await log("debug", `planner: ${warning}`);
    }
    // The actual provider that ran this job, not an env lookup. A rejected
    // key (`planner_llm_failed:auth`) means nothing real happened either,
    // even though `llm.name` still reports "anthropic".
    sourceModes.llm = llm.name === "fake" ? "fixture" : "live";
    if (planResult.warnings.some((w) => w === "planner_llm_failed:auth")) {
      sourceModes.llm = "fixture";
    }
    // Run-page banners: tell the user plainly when the LLM is not really running.
    // `source: "degraded-llm"` is the machine key the web UI keys the banner off.
    if (llm.name === "fake") {
      await log(
        "warn",
        "No Anthropic API key (ANTHROPIC_API_KEY) is set — planning and extraction run on a stub, so results are low quality and largely canned.",
        "degraded-llm",
      );
    } else if (
      planResult.warnings.some((w) => /^planner_llm_failed:/.test(w))
    ) {
      await log(
        "warn",
        "The Anthropic API call failed (key rejected or unreachable) — planning fell back to your selected requirements only.",
        "degraded-llm",
      );
    }
    // A live (paid, recorded) Solari session can only pay for itself when the LLM
    // that writes the queries and reads the pages is really running. A fake planner
    // produces canned queries and a fake extractor returns canned places — four live
    // browser sessions on top of that is pure waste (run 2). `:network` / `:schema`
    // failures are transient — downgrading a correctly-keyed run to canned data over
    // one bad retry would be worse than the waste this is meant to avoid.
    const llmUnusable =
      llm.name === "fake" ||
      planResult.warnings.some((w) => w === "planner_llm_failed:auth");
    const solariKeyForGate = (deps.solariKey ?? env.SOLARI_API_KEY)?.trim();
    if (llmUnusable && solariKeyForGate) {
      await log(
        "warn",
        "A Solari API key is set, but there is no working Anthropic key — a live cloud browser would only be able to run canned queries, so this run used recorded sample data instead and spent no Solari usage.",
        "solari-skipped-no-llm",
      );
    }

    const requirements =
      planResult.requirements.length > 0 ? planResult.requirements : job.requirements;
    await log(
      "info",
      `planned ${requirements.length} requirement(s): ${requirements.map((r) => r.label).join(", ") || "(none)"}`,
    );

    // 5. union adapters from the planned intents
    const intentIds =
      planResult.intentIds.length > 0 ? planResult.intentIds : job.intentIds;
    const adapterIds = adapterIdsFor(intentIds);
    await log(
      "info",
      `intents [${intentIds.join(", ") || "none"}] → adapters [${adapterIds.join(", ") || "none"}]`,
    );
    const adapters = await registry.resolve(adapterIds, log);
    await log(
      "info",
      `${adapters.length} adapter(s) ready; browser concurrency capped at ${MAX_CONCURRENT_BROWSERS}`,
    );

    // 6-8. run adapters (each its own session; stealth/captcha/recording/proxy
    //      requested inside launchBrowser; extract -> Zod -> evidence per adapter)
    const run = await runAdapters({
      adapters,
      job,
      requirements,
      intentIds,
      searchLang,
      queries: planResult.queries,
      llm,
      log,
      budget,
      replays,
      sourceModes,
      env,
      solariKey: deps.solariKey,
      browserFactory: deps.browserFactory,
      allowLive: !llmUnusable,
      drainMs: deps.drainMs ?? DEFAULT_DRAIN_MS,
    });
    findings = run.findings;
    timedOut = run.timedOut;

    // 9. merge + score + dossier
    await log("info", `merging ${findings.length} finding(s) across sources`);
    const merged = mergeFindings(findings);
    await log("info", `${merged.length} distinct place(s) after canonical-key merge`);
    const written = await writeDossier(db, jobId, merged, replays, log);
    await persistSourceModes(db, jobId, sourceModes, log);

    // 10 + 11. terminal state. The closing event is appended BEFORE `finishJob`
    // on every path: the SSE route stops tailing as soon as it sees a terminal
    // status, so a row written after the flip races the stream closing.
    if (budget.expired || timedOut) {
      await log(
        "warn",
        `stopped at the ${budgetSec}s budget — wrote partial results (${written.placeCount} place(s))`,
      );
      await log("info", "job finished: partial");
      await finishJob(db, jobId, "partial");
      return result("partial", written, log);
    }

    await log(
      "info",
      `job finished: done — ${written.placeCount} place(s), ${written.evidenceCount} evidence, ${written.conflictedCount} conflicted`,
    );
    await finishJob(db, jobId, "done");
    return result("done", written, log);
  } catch (err) {
    if (isAbortError(err) || budget.expired) {
      await log("warn", `timeout — writing whatever exists (${describeError(err)})`);
      const merged = mergeFindings(findings);
      try {
        await writeDossier(db, jobId, merged, replays, log);
      } catch (writeErr) {
        await log("error", `partial dossier write failed: ${describeError(writeErr)}`);
      }
      await persistSourceModes(db, jobId, sourceModes, log);
      await log("info", "job finished: partial");
      await finishJob(db, jobId, "partial");
      return { status: "partial", placeCount: merged.length, evidenceCount: 0, events: log.count };
    }
    // A failed run still recorded whatever ran before it threw — persist it on
    // this terminal path too, or the History card claims "provenance not
    // recorded" for a run we actually have provenance for.
    await persistSourceModes(db, jobId, sourceModes, log);
    // `error_text` does NOT pass through the logger, so it gets its own scrub.
    const text = scrubSecrets(describeError(err), secrets);
    await log("error", `job failed: ${text}`);
    await finishJob(db, jobId, "error", truncate(text, MAX_ERROR_TEXT));
    return { status: "error", placeCount: 0, evidenceCount: 0, events: log.count };
  } finally {
    budget.dispose();
  }
}

/**
 * Best-effort write of the recorded per-source modes, next to `writeDossier`.
 * A failure here must not fail the job — same contract as the partial dossier
 * write just above it.
 */
async function persistSourceModes(
  db: DbHandle,
  jobId: string,
  sourceModes: Record<string, SourceMode>,
  log: JobLogger,
): Promise<void> {
  try {
    await setJobSourceModes(db, jobId, sourceModes);
  } catch (err) {
    await log("warn", `could not persist source modes: ${describeError(err)}`);
  }
}

function result(
  status: "done" | "partial",
  written: { placeCount: number; evidenceCount: number },
  log: JobLogger,
): RunJobOutcome {
  return {
    status,
    placeCount: written.placeCount,
    evidenceCount: written.evidenceCount,
    events: log.count,
  };
}

function collectExtras(
  requirements: readonly PlannedRequirement[],
): { allergens?: string[]; diet?: string } | undefined {
  const allergens = new Set<string>();
  let diet: string | undefined;
  for (const requirement of requirements) {
    for (const allergen of requirement.allergens ?? []) allergens.add(allergen);
    if (!diet && requirement.diet) diet = requirement.diet;
  }
  if (allergens.size === 0 && !diet) return undefined;
  const out: { allergens?: string[]; diet?: string } = {};
  if (allergens.size > 0) out.allergens = [...allergens];
  if (diet) out.diet = diet;
  return out;
}

// ---------------------------------------------------------------------------

interface RunAdaptersArgs {
  adapters: Adapter[];
  job: Job;
  requirements: PlannedRequirement[];
  intentIds: string[];
  searchLang: SearchLanguage;
  queries: SearchQuery[];
  llm: LlmProvider;
  log: JobLogger;
  budget: JobBudget;
  replays: DossierReplay[];
  /** Mutated in place, keyed by adapter id — the reserved `"llm"` key is
   *  already seeded by the caller before `runAdapters` is invoked. */
  sourceModes: Record<string, SourceMode>;
  env: ReturnType<typeof loadEnv>;
  solariKey?: string;
  browserFactory?: (opts: LaunchOptions) => Promise<BrowserSession>;
  /** `false` when the LLM is unusable — no working browser session is worth
   *  paying for. Forwarded to `launchBrowser`; also gates the `degraded-solari`
   *  notice, which would otherwise mislead ("could not start") when the real
   *  reason is that this run never tried. */
  allowLive: boolean;
  drainMs: number;
}

async function runAdapters(
  args: RunAdaptersArgs,
): Promise<{ findings: PlaceFinding[]; timedOut: boolean }> {
  const findings: PlaceFinding[] = [];
  const queue = [...args.adapters];
  const active = new Set<Promise<void>>();
  const started: Promise<void>[] = [];
  let timedOut = false;
  // Emit the "Solari key set but the browser fell back to fixtures" banner once,
  // not once per adapter. The set is synchronous before any `await`, so the
  // concurrent tasks cannot both send it.
  const solariKeyPresent = Boolean(
    (args.solariKey ?? args.env.SOLARI_API_KEY)?.trim(),
  );
  let solariNoticeSent = false;

  const startOne = (adapter: Adapter): Promise<void> => {
    const task = (async () => {
      if (args.budget.expired) {
        timedOut = true;
        return;
      }
      const supportedIntents = args.intentIds.filter((id) => adapter.supports(id));
      // `buildSearchQueries` emits one row per (intent, adapter) and the query
      // TEXT is identical across the adapters of an intent — so this must dedupe
      // or every adapter runs each search once per sibling adapter.
      const scopedQueries = dedupe(
        args.queries
          .filter(
            (q) =>
              q.adapterId === adapter.id ||
              supportedIntents.includes(q.intentId),
          )
          .map((q) => q.query),
      );
      const queries =
        scopedQueries.length > 0
          ? scopedQueries
          : dedupe(args.queries.map((q) => q.query));
      const limit = intentLimit(supportedIntents);

      let browser: BrowserSession | undefined;
      // Captured in this outer scope, not inside the try, so the `finally`
      // below can still see it after a throw or a timeout abort.
      let findingCount = 0;
      try {
        if (adapter.needsBrowser === false) {
          await args.log("debug", `[${adapter.id}] no browser needed`);
          browser = new FixtureBrowserSession(undefined);
          // `"stub"`, NOT `"fixture"`: these adapters are the v1.1 no-ops that
          // return `{findings: []}`. They ran and contributed nothing — they
          // did not stand in recorded sample data for a live result. Calling
          // them `"fixture"` would fire the dossier's sample-data strip and
          // the History badge on every run, live ones included.
          args.sourceModes[adapter.id] = "stub";
        } else {
          browser = await launchBrowser({
            jobId: args.job.id,
            location: args.job.location,
            apiKey: args.solariKey ?? args.env.SOLARI_API_KEY,
            allowLive: args.allowLive,
            log: (level, message) => args.log(level, `[${adapter.id}] ${message}`),
            factory: args.browserFactory,
          });
          // Written synchronously, right after `launchBrowser` resolves and
          // before any further `await` — `runAdapters` drives up to 3 of
          // these concurrently, but distinct adapter-id keys on a
          // single-threaded event loop make this safe as long as nothing
          // yields in between.
          args.sourceModes[adapter.id] = browser.mode;
          await args.log(
            "info",
            `[${adapter.id}] browser session ${browser.sessionId} (${browser.mode})`,
          );
          if (
            args.allowLive &&
            solariKeyPresent &&
            browser.mode === "fixture" &&
            !solariNoticeSent
          ) {
            solariNoticeSent = true;
            await args.log(
              "warn",
              "A Solari API key is set but the cloud browser could not start — this run used recorded sample data instead. The reason is in the warning just above.",
              "degraded-solari",
            );
          }
        }

        const adapterResult = await adapter.run({
          jobId: args.job.id,
          intentIds: supportedIntents,
          location: args.job.location,
          searchLang: args.searchLang,
          uiLocale: args.job.uiLocale,
          requirements: args.requirements.filter((r) =>
            r.intentIds.some((i) => supportedIntents.includes(i)),
          ),
          queries,
          limit,
          browser,
          llm: args.llm,
          log: (level, message) => args.log(level, `[${adapter.id}] ${message}`),
          signal: args.budget.signal,
        });
        findingCount = adapterResult.findings.length;
        findings.push(...adapterResult.findings);
        await args.log("info", `[${adapter.id}] ${findingCount} finding(s)`);
      } catch (err) {
        if (isAbortError(err)) {
          timedOut = true;
          await args.log("warn", `[${adapter.id}] aborted at the timeout`);
        } else {
          await args.log(
            "error",
            `adapter ${adapter.id} failed: ${describeError(err)} — continuing`,
          );
        }
      } finally {
        if (browser) {
          // Best-effort, always: a replay capture must never fail the job or
          // slow it down. Fixture sessions never recorded anything — nothing
          // to capture, so skip the whole block for them.
          if (browser.mode !== "fixture") {
            try {
              await captureReplay(browser, adapter.id, findingCount, args);
            } catch {
              /* replay capture is best-effort */
            }
          }
          try {
            await browser.close();
          } catch {
            /* an orphaned session is worse than a noisy log */
          }
        }
      }
    })();
    return task;
  };

  while (queue.length > 0 && !args.budget.expired) {
    while (
      active.size < MAX_CONCURRENT_BROWSERS &&
      queue.length > 0 &&
      !args.budget.expired
    ) {
      const adapter = queue.shift();
      if (!adapter) break;
      const task = startOne(adapter);
      started.push(task);
      active.add(task);
      // The task swallows its own errors, but a throw from inside its catch /
      // finally (a failing log write) would reject this derived promise with
      // nothing attached — an unhandledRejection. `Promise.allSettled(started)`
      // below is what actually waits on the work.
      void task.finally(() => active.delete(task)).catch(() => undefined);
    }
    if (active.size === 0) break;
    await Promise.race([...active, args.budget.whenExpired()]);
  }

  if (args.budget.expired && queue.length > 0) {
    timedOut = true;
    await args.log(
      "warn",
      `timeout reached — ${queue.length} adapter(s) not started`,
    );
  }

  // Drain: every started task settles on its own (each catches its own errors,
  // so none of these ever reject), OR — once the budget is spent — after a short
  // grace period, so a genuinely hung adapter cannot pin the job open.
  await Promise.race([
    Promise.allSettled(started),
    args.budget
      .whenExpired()
      .then(
        () => new Promise<void>((r) => void setTimeout(r, args.drainMs).unref?.()),
      ),
  ]);

  return { findings, timedOut };
}

/**
 * Build one `DossierReplay` for this adapter's session and push it onto
 * `args.replays`. Called from the per-adapter `finally`, already wrapped in a
 * try/catch by the caller — nothing here may fail the job.
 *
 * Order matters: `getReplayUrl()` runs first because it is what releases the
 * session (the SDK internally re-mints its own URL inside `downloadReplay`,
 * so a `getReplayUrl()` failure does not have to abort the download). Each
 * SDK call gets its own try/catch so a failure in one still lets the other
 * run.
 */
async function captureReplay(
  browser: BrowserSession,
  adapterId: string,
  findingCount: number,
  args: RunAdaptersArgs,
): Promise<void> {
  let urlResult: { url: string; expiresAt: number } | undefined;
  try {
    urlResult = await browser.getReplayUrl();
  } catch {
    /* best-effort */
  }

  // The budget is already spent — a download would only delay the job for a
  // recording nobody's waiting on. Fall back to whatever URL we have.
  if (args.budget.expired) {
    pushReplay(args, browser.sessionId, adapterId, findingCount, urlResult, {
      status: urlResult ? "link_only" : "unavailable",
    });
    return;
  }

  let downloaded: Awaited<ReturnType<BrowserSession["downloadReplay"]>>;
  try {
    downloaded = await browser.downloadReplay(REPLAY_MAX_BYTES);
  } catch {
    downloaded = undefined;
  }

  if (downloaded === REPLAY_TOO_LARGE) {
    // The recording exists and is fine — it is just bigger than the cap we are
    // willing to hold in memory and write to disk. Saying so is the difference
    // between "raise the cap" and "recording is off on this plan"; a bare
    // "unavailable" would send the reader after the wrong problem.
    pushReplay(args, browser.sessionId, adapterId, findingCount, urlResult, {
      status: "too_large",
    });
    await args.log(
      "info",
      `[${adapterId}] replay too large to store (over the ${formatBytes(REPLAY_MAX_BYTES)} cap)`,
    );
    return;
  }

  if (!downloaded) {
    // Nothing came back at all: no recording on this plan, or the fetch
    // failed — `downloadReplay` already logged a warn naming which. A safe
    // URL, if we have one, still lets the user watch it before it expires;
    // otherwise this is the "nothing at all" case.
    pushReplay(args, browser.sessionId, adapterId, findingCount, urlResult, {
      status: urlResult ? "link_only" : "unavailable",
    });
    await args.log(
      "info",
      urlResult
        ? `[${adapterId}] replay link only (download unavailable)`
        : `[${adapterId}] replay unavailable`,
    );
    return;
  }

  if (downloaded.bytes.byteLength === 0) {
    pushReplay(args, browser.sessionId, adapterId, findingCount, urlResult, {
      status: "empty",
    });
    await args.log(
      "info",
      `[${adapterId}] replay empty — the session navigated nowhere`,
    );
    return;
  }

  try {
    const stored = await storeReplay(args.job.id, browser.sessionId, downloaded);
    pushReplay(args, browser.sessionId, adapterId, findingCount, urlResult, {
      status: "stored",
      storedPath: stored.relativePath,
      sizeBytes: stored.sizeBytes,
      contentType: stored.contentType,
    });
    await args.log(
      "info",
      `[${adapterId}] replay stored (${formatBytes(stored.sizeBytes)})`,
    );
  } catch (err) {
    pushReplay(args, browser.sessionId, adapterId, findingCount, urlResult, {
      status: urlResult ? "link_only" : "unavailable",
    });
    await args.log(
      "warn",
      `[${adapterId}] replay could not be stored to disk (${describeError(err)})`,
    );
  }
}

function pushReplay(
  args: RunAdaptersArgs,
  sessionId: string,
  adapterId: string,
  findingCount: number,
  urlResult: { url: string; expiresAt: number } | undefined,
  extra: Pick<DossierReplay, "status" | "storedPath" | "sizeBytes" | "contentType">,
): void {
  args.replays.push({
    sessionId,
    adapterId,
    findingCount,
    url: urlResult?.url,
    expiresAt: urlResult?.expiresAt,
    ...extra,
  });
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(1)} KB`;
  return `${bytes} B`;
}

function intentLimit(intentIds: readonly string[]): number {
  let limit = 8;
  for (const id of intentIds) {
    const intent = getIntent(id);
    if (intent && intent.defaultLimit > limit) limit = intent.defaultLimit;
  }
  return limit;
}
