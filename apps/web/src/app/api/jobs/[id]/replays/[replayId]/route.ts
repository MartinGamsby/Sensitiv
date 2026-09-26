// GET /api/jobs/:id/replays/:replayId — serves a stored replay's bytes.
//
// The replay was downloaded server-side while its presigned Solari URL was
// still live (see `apps/worker/src/replay-store.ts`) and now lives under
// `data/replays/`. This route is the ONLY thing that reads those bytes back:
// the path is resolved from a `user_id`-scoped DB row, never from request
// input, and asserted to stay under the `data/replays` root before any read.
//
// A job that does not exist OR belongs to another user, and a replay that
// is not `status: "stored"`, both return the same 404 — never a
// distinguishable 403, matching `apps/web/src/app/api/jobs/[id]/route.ts`.
import { readFile } from "node:fs/promises";
import { getJob, getReplayForJob, resolveStoredReplayPath } from "@sensitiv/db";
import { getWebDeps } from "../../../../../../server/deps.ts";
import { errorResponse } from "../../../../../../server/http.ts";
import { rejectNonLocal } from "../../../../../../server/local-only.ts";
import { getCurrentUser } from "../../../../../../server/user.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Replay bytes are attacker-influenceable third-party content: always
 *  `attachment` + `nosniff`, never inline, never `text/html`. Deliberately no
 *  `content-encoding` header — the stored `.gz` file is already gzip on
 *  disk, and setting it would make the browser transparently decompress it
 *  AGAIN while still naming the download `.ndjson.gz` (cause 2 in the
 *  section-2 writeup: exactly the bug this change fixes). */
function extensionFor(contentType: string): string {
  return contentType === "application/gzip" ? ".ndjson.gz" : ".ndjson";
}

/** `replays.content_type` is a free-text column. Only the two values
 *  `storeReplay()` can write are ever echoed into a response header — anything
 *  else (a hand-edited row, a future writer) falls back to NDJSON rather than
 *  letting an arbitrary string, `text/html` included, reach the browser. */
const ALLOWED_CONTENT_TYPES = new Set(["application/gzip", "application/x-ndjson"]);

function contentTypeFor(raw: string | null): string {
  return raw !== null && ALLOWED_CONTENT_TYPES.has(raw) ? raw : "application/x-ndjson";
}

/** ASCII-only, everything but `[A-Za-z0-9_-]` dropped. `adapterId` is a
 *  catalog id already shaped that way, but sanitize anyway — it still ends
 *  up in an HTTP header. */
function sanitizeForFilename(raw: string): string {
  return raw.replace(/[^A-Za-z0-9_-]/g, "") || "replay";
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string; replayId: string }> },
): Promise<Response> {
  const refused = rejectNonLocal(req);
  if (refused) return refused;
  const { db } = await getWebDeps();
  const { id, replayId } = await ctx.params;
  const user = await getCurrentUser();

  const job = await getJob(db, id, user.id);
  if (!job) return errorResponse(404, "not found");

  const replay = await getReplayForJob(db, id, replayId);
  if (!replay || replay.status !== "stored" || replay.storedPath == null) {
    return errorResponse(404, "not found");
  }

  // Defence in depth: `storedPath` is ours (written by `storeReplay()`,
  // never taken from a request), but the resolved absolute path is still
  // asserted to stay under `data/replays` before any read. The check lives in
  // `@sensitiv/db` next to `findRepoRoot()` so the worker that writes these
  // files and this route that reads them share one implementation.
  const abs = resolveStoredReplayPath(replay.storedPath);
  if (!abs) return errorResponse(404, "not found");

  let bytes: Buffer;
  try {
    bytes = await readFile(abs);
  } catch {
    // A missing file on disk (the user deleted `data/`) is a 404, not a 500.
    return errorResponse(404, "not found");
  }

  const contentType = contentTypeFor(replay.contentType);
  const adapterPart = sanitizeForFilename(replay.adapterId ?? "replay");
  const shortId = sanitizeForFilename(replay.id.slice(0, 8));
  const filename = `sensitiv-replay-${adapterPart}-${shortId}${extensionFor(contentType)}`;

  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "content-type": contentType,
      "content-disposition": `attachment; filename="${filename}"`,
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
    },
  });
}
