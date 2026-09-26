// GET    /api/jobs/:id — the dossier + status for a job the caller owns.
// DELETE /api/jobs/:id — forget that run entirely.
//
// A job that does not exist OR belongs to another user returns 404 from both
// (never a distinguishable 403 — we don't confirm existence).
import { rm, unlink } from "node:fs/promises";
import { join } from "node:path";
import {
  deleteJobForUser,
  getDossier,
  getJob,
  resolveStoredReplayPath,
} from "@sensitiv/db";
import { getWebDeps } from "../../../../server/deps.ts";
import { errorResponse, jsonResponse } from "../../../../server/http.ts";
import { rejectNonLocal } from "../../../../server/local-only.ts";
import { describeError, logger } from "../../../../server/logger.ts";
import { getCurrentUser } from "../../../../server/user.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const refused = rejectNonLocal(req);
  if (refused) return refused;
  const { db } = await getWebDeps();
  const { id } = await ctx.params;
  const user = await getCurrentUser();

  const dossier = await getDossier(db, id, user.id);
  if (!dossier) return errorResponse(404, "not found");

  // `getDossier` already embeds `disclaimer: disclaimerFor(uiLocale)`.
  return jsonResponse(200, dossier);
}

/**
 * A run in flight is not the user's to delete yet.
 *
 * The worker appends `job_events` rows against `jobs.id` for as long as it is
 * running, and `PRAGMA foreign_keys` is ON, so pulling the row out from under
 * it would crash the run rather than cancel it. Cancellation is a different
 * feature; until it exists, this says so instead of pretending.
 */
const DELETABLE_STATUSES = new Set(["done", "partial", "error"]);

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const refused = rejectNonLocal(req);
  if (refused) return refused;
  const { db } = await getWebDeps();
  const { id } = await ctx.params;
  const user = await getCurrentUser();

  const job = await getJob(db, id, user.id);
  if (!job) return errorResponse(404, "not found");
  if (!DELETABLE_STATUSES.has(job.status)) {
    return errorResponse(409, "this run is still going");
  }

  const deleted = await deleteJobForUser(db, id, user.id);
  // Lost a race with another delete of the same run. The rows are gone either
  // way, which is what the caller asked for.
  if (!deleted) return jsonResponse(200, { deleted: true });

  // The rows are gone; the recordings on disk are a separate contract that
  // `@sensitiv/db` deliberately does not touch. Every path goes through
  // `resolveStoredReplayPath` first — `stored_path` is a DB value, and an
  // unguarded unlink over one is a delete primitive aimed at a string we did
  // not re-derive. A path that fails containment is skipped, exactly as the
  // worker's retention sweep skips it.
  for (const relative of deleted.storedReplayPaths) {
    const abs = resolveStoredReplayPath(relative);
    if (!abs) {
      logger.warn(`refusing to unlink replay outside data/replays: ${relative}`);
      continue;
    }
    try {
      await unlink(abs);
    } catch (err) {
      // Already gone, or the file was never written. The row is what mattered.
      logger.info(`could not unlink ${relative}: ${describeError(err)}`);
    }
  }

  // The run's own folder, if this emptied it. `job.id` is a DB value, not the
  // request path, and it is re-checked for containment like the files were;
  // a non-recursive remove fails harmlessly when anything is left inside.
  const jobDir = resolveStoredReplayPath(join("data", "replays", job.id));
  if (jobDir) {
    try {
      await rm(jobDir, { recursive: false });
    } catch {
      // Not empty, or never existed. Neither is a failure of the delete.
    }
  }

  return jsonResponse(200, { deleted: true });
}
