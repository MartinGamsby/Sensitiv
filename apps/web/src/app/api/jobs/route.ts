// POST /api/jobs  — validate, plan, insert a queued job, best-effort enqueue.
// GET  /api/jobs  — the current user's recent jobs (trimmed).
//
// Node runtime only: this handler touches SQLite and imports the server-only env.
import {
  JobCreateInputStrictSchema,
  MAX_JOB_TIMEOUT_SEC,
  MIN_JOB_TIMEOUT_SEC,
  resolveSearchLanguage,
  type PlannedRequirement,
  type SearchLanguage,
} from "@sensitiv/shared";
import { createLlmProvider } from "@sensitiv/shared/llm";
import { plan } from "@sensitiv/shared/planner";
import {
  intentsForRequirements,
  makeCustomRequirement,
  toPlannedRequirement,
  validateRequirementIds,
} from "@sensitiv/shared/catalog/index";
import { createJob, listJobsForUser, updateUserSettings } from "@sensitiv/db";
import { getWebDeps } from "../../../server/deps.ts";
import { postJobToWorker } from "../../../server/enqueue.ts";
import { errorResponse, jsonResponse, readJson } from "../../../server/http.ts";
import { describeError, logger } from "../../../server/logger.ts";
import { getCurrentUser } from "../../../server/user.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clampTimeout(seconds: number): number {
  return Math.min(
    MAX_JOB_TIMEOUT_SEC,
    Math.max(MIN_JOB_TIMEOUT_SEC, Math.round(seconds)),
  );
}

/** Chip-only requirement derivation — the fallback when the planner throws. */
function deriveChipRequirements(
  chipIds: readonly string[],
  uiLocale: "en" | "fr",
  extras: { allergens?: string[]; diet?: string },
): { requirements: PlannedRequirement[]; intentIds: string[] } {
  const { valid } = validateRequirementIds(chipIds);
  const requirements = valid.map((id) =>
    toPlannedRequirement(id, uiLocale, extras),
  );
  if (requirements.length === 0) {
    requirements.push(makeCustomRequirement("", ["dining"], []));
  }
  const intentIds = new Set<string>();
  for (const req of requirements) for (const i of req.intentIds) intentIds.add(i);
  for (const i of intentsForRequirements(valid)) intentIds.add(i);
  return { requirements, intentIds: [...intentIds] };
}

export async function POST(req: Request): Promise<Response> {
  const { db, env, fetch: fetchImpl } = await getWebDeps();

  const raw = await readJson(req);
  if (raw === undefined || typeof raw !== "object" || raw === null) {
    return errorResponse(400, "request body must be a JSON object");
  }

  const rawObj = raw as Record<string, unknown>;
  // Clamp the timeout BEFORE Zod sees it — the shared schema would reject an
  // out-of-range value, but the spec calls for a clamp, not a rejection.
  const hadTimeout = rawObj["timeoutSec"] !== undefined;
  const body: Record<string, unknown> = { ...rawObj };
  if (typeof body["timeoutSec"] === "number") {
    body["timeoutSec"] = clampTimeout(body["timeoutSec"]);
  }
  // `saveAsDefault` is not part of the shared schema (which strips unknown keys),
  // so read it straight off the raw body.
  const saveAsDefault = rawObj["saveAsDefault"] === true;

  const parsed = JobCreateInputStrictSchema.safeParse(body);
  if (!parsed.success) {
    return jsonResponse(400, {
      error: "invalid job input",
      issues: parsed.error.flatten(),
    });
  }
  const input = parsed.data;

  // BYOK Solari key: pull it off immediately. From here on it exists only as this
  // local variable and is handed to the worker in memory. It is NEVER written to
  // a `jobs` column, a log line, or the response.
  const solariKey =
    typeof input.solariKey === "string" && input.solariKey.trim() !== ""
      ? input.solariKey.trim()
      : undefined;

  const user = await getCurrentUser();

  const searchLang: SearchLanguage =
    typeof input.searchLang === "string" && input.searchLang.trim() !== ""
      ? { code: input.searchLang.trim(), source: "user" }
      : resolveSearchLanguage(input.location, user.defaultSearchLang);

  const timeoutSec = hadTimeout
    ? input.timeoutSec
    : clampTimeout(user.defaultTimeoutSec);

  const extras = {
    allergens: input.allergens,
    diet: input.diet,
  };

  let requirements: PlannedRequirement[];
  let intentIds: string[];
  let planWarnings: string[] = [];
  try {
    const provider = createLlmProvider(
      {
        LLM_PROVIDER: env.LLM_PROVIDER,
        ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
      },
      { warn: () => {} },
    );
    const result = await plan({
      requestText: input.requestText,
      chipIds: input.chipIds,
      extras,
      location: input.location,
      searchLang,
      uiLocale: input.uiLocale,
      provider,
    });
    requirements = result.requirements;
    intentIds = result.intentIds;
    planWarnings = result.warnings;
  } catch (err) {
    // Never 500 on a planner hiccup: fall back to chip-derived requirements and
    // record a warning event once the job row exists.
    logger.warn(
      `planner failed for a new job; using chip-derived requirements (${describeError(err)})`,
    );
    const derived = deriveChipRequirements(input.chipIds, input.uiLocale, {
      allergens: input.allergens,
      diet: input.diet,
    });
    requirements = derived.requirements;
    intentIds = derived.intentIds;
    planWarnings = ["planner_failed_fallback"];
  }

  const job = await createJob(db, {
    userId: user.id,
    location: input.location,
    requestText: input.requestText,
    requirements,
    intentIds,
    searchLang: searchLang.code,
    uiLocale: input.uiLocale,
    timeoutSec,
  });

  if (planWarnings.length > 0) {
    logger.info(`job ${job.id} planner warnings: ${planWarnings.join(", ")}`);
  }

  // Persist the timeout as the new default only if the client asked.
  if (saveAsDefault && timeoutSec !== user.defaultTimeoutSec) {
    try {
      await updateUserSettings(db, user.id, { defaultTimeoutSec: timeoutSec });
    } catch (err) {
      logger.warn(`could not save default timeout: ${describeError(err)}`);
    }
  }

  // Fire-and-forget. Failure leaves the job queued for the worker poll loop.
  await postJobToWorker({
    jobId: job.id,
    solariKey,
    workerUrl: env.WORKER_URL,
    fetchImpl,
  });

  return jsonResponse(201, { jobId: job.id });
}

export async function GET(): Promise<Response> {
  const { db } = await getWebDeps();
  const user = await getCurrentUser();
  const jobs = await listJobsForUser(db, user.id, 50);
  return jsonResponse(200, {
    jobs: jobs.map((job) => ({
      id: job.id,
      status: job.status,
      requestText: job.requestText,
      location: { query: job.location.query },
      createdAt: job.createdAt,
    })),
  });
}
