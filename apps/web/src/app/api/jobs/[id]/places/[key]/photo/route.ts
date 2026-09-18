// GET /api/jobs/:id/places/:key/photo — one place's picture, served from our
// own origin.
//
// Why a proxy and not an `<img src>` pointing at the original host:
//
//   * The card used to accept only `*.googleusercontent.com`, because a
//     scraped URL becoming an `<img src>` is a URL a stranger chose for the
//     reader's browser to fetch. That kept the page safe and left every place
//     Google has no photo carousel for showing nothing at all.
//   * Fetching server-side turns the trade-off around. The page's image
//     sources stay entirely on our own origin — narrower than before, not
//     wider — while the set of hosts a PHOTO may come from can open up to any
//     public https address. The reader's IP, and the fact that they opened
//     this dossier, never reach the third party either.
//
// The URL is read from a `user_id`-scoped DB row, never from request input,
// and re-validated with `isSafePhotoUrl` — the same function the worker used
// before storing it, because a row written by an older build predates the
// check. Redirects are refused, the body is capped, and only real image
// content types are echoed back.
import {
  getJob,
  getPlacePhotoUrl,
} from "@sensitiv/db";
import { isSafePhotoUrl } from "@sensitiv/shared/safe-url";
import { getWebDeps } from "../../../../../../../server/deps.ts";
import { errorResponse } from "../../../../../../../server/http.ts";
import { describeError, logger } from "../../../../../../../server/logger.ts";
import { getCurrentUser } from "../../../../../../../server/user.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Generous for a photo, short enough that a dead host does not hold a
 *  connection open while the reader stares at a blank tile. */
const FETCH_TIMEOUT_MS = 8_000;

/** A place photo that does not fit in this is not a thumbnail. The cap is
 *  enforced on the bytes actually read, not on `content-length`, which a
 *  hostile host is free to lie about. */
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

/**
 * The only content types that come back out.
 *
 * An allowlist rather than a "starts with `image/`" test: `image/svg+xml` is
 * a document that can carry script, and serving one from our own origin is
 * stored XSS with extra steps. It is not on this list and must not be added.
 */
const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
]);

function imageTypeOf(raw: string | null): string | undefined {
  const bare = (raw ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  return ALLOWED_IMAGE_TYPES.has(bare) ? bare : undefined;
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string; key: string }> },
): Promise<Response> {
  const { db, fetch: fetchImpl } = await getWebDeps();
  const { id, key } = await ctx.params;
  const user = await getCurrentUser();

  // Ownership first, and a 404 for everything after it — a job that is not
  // yours is indistinguishable from one that does not exist, matching the
  // dossier and replay routes.
  const job = await getJob(db, id, user.id);
  if (!job) return errorResponse(404, "not found");

  const stored = await getPlacePhotoUrl(db, id, decodeURIComponent(key));
  if (!stored || !isSafePhotoUrl(stored)) return errorResponse(404, "not found");

  let upstream: Response;
  try {
    upstream = await fetchImpl(stored, {
      // A followed redirect walks the request off the host the gate approved,
      // which is the whole point of having approved one.
      redirect: "error",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { accept: "image/*" },
    });
  } catch (err) {
    // Never log the URL itself at warn level with the error text around it —
    // the host is enough to debug with and the path can carry a token.
    logger.info(`place photo fetch failed: ${describeError(err)}`);
    return errorResponse(404, "not found");
  }

  if (!upstream.ok) return errorResponse(404, "not found");

  const contentType = imageTypeOf(upstream.headers.get("content-type"));
  if (!contentType) return errorResponse(404, "not found");

  const bytes = new Uint8Array(await upstream.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_PHOTO_BYTES) {
    return errorResponse(404, "not found");
  }

  return new Response(bytes, {
    status: 200,
    headers: {
      "content-type": contentType,
      // `nosniff` matters more here than usual: the bytes are third-party and
      // they are now being served from OUR origin, so a browser guessing
      // "actually this is HTML" would be guessing it into our security
      // context. The CSP is a second, independent stop on the same thing.
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
      "cross-origin-resource-policy": "same-origin",
      // A dossier is re-read; a photo URL is stable for as long as the row is.
      // `private` because the response is scoped to one user's job.
      "cache-control": "private, max-age=86400",
    },
  });
}
