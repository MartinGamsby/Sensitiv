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
  type DbHandle,
  type Job,
} from "@sensitiv/db";
import {
  resolveSearchLanguage,
  type PlannedRequirement,
  type SearchLanguage,
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
import { launchBrowser, type BrowserSession, type LaunchOptions } from "./browser/solari.ts";
import { writeDossier, type DossierReplay } from "./dossier.ts";
import { createJobLogger, type JobLogger } from "./logger.ts";
import { mergeFindings } from "./merge.ts";
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
      env,
      solariKey: deps.solariKey,
      browserFactory: deps.browserFactory,
      drainMs: deps.drainMs ?? DEFAULT_DRAIN_MS,
    });
    findings = run.findings;
    timedOut = run.timedOut;

    // 9. merge + score + dossier
    await log("info", `merging ${findings.length} finding(s) across sources`);
    const merged = mergeFindings(findings);
    await log("info", `${merged.length} distinct place(s) after canonical-key merge`);
    const written = await writeDossier(db, jobId, merged, replays, log);

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
      await log("info", "job finished: partial");
      await finishJob(db, jobId, "partial");
      return { status: "partial", placeCount: merged.length, evidenceCount: 0, events: log.count };
    }
    // `error_text` does NOT pass through the logger, so it gets its own scrub.
    const text = scrubSecrets(describeError(err), secrets);
    await log("error", `job failed: ${text}`);
    await finishJob(db, jobId, "error", truncate(text, MAX_ERROR_TEXT));
    return { status: "error", placeCount: 0, evidenceCount: 0, events: log.count };
  } finally {
    budget.dispose();
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
  env: ReturnType<typeof loadEnv>;
  solariKey?: string;
  browserFactory?: (opts: LaunchOptions) => Promise<BrowserSession>;
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
      try {
        browser = await launchBrowser({
          jobId: args.job.id,
          location: args.job.location,
          apiKey: args.solariKey ?? args.env.SOLARI_API_KEY,
          log: (level, message) => args.log(level, `[${adapter.id}] ${message}`),
          factory: args.browserFactory,
        });
        await args.log(
          "info",
          `[${adapter.id}] browser session ${browser.sessionId} (${browser.mode})`,
        );

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
        findings.push(...adapterResult.findings);
        await args.log(
          "info",
          `[${adapter.id}] ${adapterResult.findings.length} finding(s)`,
        );
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
          try {
            const replayUrl = await browser.getReplayUrl();
            if (replayUrl) {
              args.replays.push({ sessionId: browser.sessionId, url: replayUrl });
            }
          } catch {
            /* replay is best-effort */
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

function intentLimit(intentIds: readonly string[]): number {
  let limit = 8;
  for (const id of intentIds) {
    const intent = getIntent(id);
    if (intent && intent.defaultLimit > limit) limit = intent.defaultLimit;
  }
  return limit;
}
