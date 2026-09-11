// POST /api/jobs  — validate, derive requirements from the catalog, insert a
//                   queued job, best-effort enqueue.
// GET  /api/jobs  — the current user's recent jobs (trimmed).
//
// Deliberately NO LLM call here. Planning is an LLM round-trip and belongs to the
// worker's agent loop (`runJob` -> `plan()`), which owns the job budget and its
// abort signal; a route handler that awaited it would block the submit on an
// unbounded network call and the worker would re-plan from `requestText` anyway.
// What this route stores is the deterministic chip->catalog derivation, which is
// also the worker's fallback when the planner returns nothing.
//
// Node runtime only: this handler touches SQLite and imports the server-only env.
import {
  JobCreateInputStrictSchema,
  MAX_JOB_TIMEOUT_SEC,
  MIN_JOB_TIMEOUT_SEC,
  resolveSearchLanguage,
  type PlannedRequirement,
  type SearchLanguage,
  type UiLocale,
} from "@sensitiv/shared";
import {
  intents,
  intentsForRequirements,
  makeCustomRequirement,
  toPlannedRequirement,
  validateRequirementIds,
} from "@sensitiv/shared/catalog/index";
import {
  createJob,
  listJobSummariesForUser,
  updateUserSettings,
} from "@sensitiv/db";
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

/**
 * Deterministic chip -> catalog derivation. Unknown chip ids are dropped (the
 * catalog fails closed); a chip-free run still gets one requirement so the
 * worker has somewhere to look. Intent ids come back in catalog declaration
 * order, matching what `plan()` produces.
 */
function deriveChipRequirements(
  chipIds: readonly string[],
  uiLocale: UiLocale,
  extras: { allergens?: string[]; diet?: string },
): { requirements: PlannedRequirement[]; intentIds: string[]; dropped: string[] } {
  const { valid, unknown } = validateRequirementIds(chipIds);
  const requirements = valid.map((id) =>
    toPlannedRequirement(id, uiLocale, extras),
  );
  if (requirements.length === 0) {
    requirements.push(makeCustomRequirement("", ["dining"], []));
  }
  const wanted = new Set<string>();
  for (const req of requirements) for (const i of req.intentIds) wanted.add(i);
  for (const i of intentsForRequirements(valid)) wanted.add(i);
  return {
    requirements,
    intentIds: intents.filter((i) => wanted.has(i.id)).map((i) => i.id),
    dropped: unknown,
  };
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

  const derived = deriveChipRequirements(input.chipIds, input.uiLocale, {
    allergens: input.allergens,
    diet: input.diet,
  });

  const job = await createJob(db, {
    userId: user.id,
    location: input.location,
    requestText: input.requestText,
    requirements: derived.requirements,
    intentIds: derived.intentIds,
    searchLang: searchLang.code,
    uiLocale: input.uiLocale,
    timeoutSec,
  });

  if (derived.dropped.length > 0) {
    logger.info(
      `job ${job.id}: dropped unknown chip id(s) ${derived.dropped.join(", ")}`,
    );
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

/** `place.name` is LLM output over scraped third-party text — bound its
 *  length before it ever reaches the History card. Rendered as text only
 *  (React escapes it); never used in an `href` or `dangerouslySetInnerHTML`. */
const MAX_TOP_PLACE_NAME = 200;

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export async function GET(): Promise<Response> {
  const { db } = await getWebDeps();
  const user = await getCurrentUser();
  // `listJobSummariesForUser` derives its place-table lookup from this user's
  // own job ids — never from request input — so the ownership boundary holds
  // for the new aggregate read too.
  const summaries = await listJobSummariesForUser(db, user.id, 50);
  return jsonResponse(200, {
    jobs: summaries.map(({ job, placeCount, topPlace }) => ({
      id: job.id,
      status: job.status,
      requestText: job.requestText,
      location: { query: job.location.query },
      createdAt: job.createdAt,
      finishedAt: job.finishedAt,
      sourceModes: job.sourceModes ?? {},
      placeCount,
      topPlace: topPlace
        ? {
            name: truncate(topPlace.name, MAX_TOP_PLACE_NAME),
            score: topPlace.score,
            conflicted: topPlace.conflicted,
          }
        : undefined,
    })),
  });
}
