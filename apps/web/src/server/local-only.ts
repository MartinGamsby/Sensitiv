// The web tier has no authentication: every request is the one local user
// (`getCurrentUser`). That is only safe while nothing but this machine's own
// pages can reach the API, so every route handler calls `rejectNonLocal` first.
//
// - `Host` must be a loopback name. A DNS-rebinding page (evil.example
//   re-pointed at 127.0.0.1) is same-origin to the browser, but it still sends
//   `Host: evil.example:3000` — that is the one thing it cannot forge.
// - `Origin`, when present, must be this same loopback origin. Browsers attach
//   it to every cross-origin request and to every non-GET, so a `no-cors`
//   `text/plain` POST from another site (a CORS "simple request", no preflight)
//   is refused here instead of starting a run on the owner's keys.
//
// This lives in the handlers, not in `middleware.ts`: middleware skips `/api`
// for next-intl, and a guard there could be bypassed by any middleware-skip bug.
import { errorResponse } from "./http.ts";

const LOOPBACK_HOST = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/i;

export function rejectNonLocal(req: Request): Response | null {
  const host = req.headers.get("host") ?? new URL(req.url).host;
  if (!LOOPBACK_HOST.test(host)) return errorResponse(403, "forbidden");

  const origin = req.headers.get("origin");
  if (origin !== null) {
    let originHost: string;
    try {
      originHost = new URL(origin).host;
    } catch {
      return errorResponse(403, "forbidden"); // e.g. the opaque "null" origin
    }
    if (originHost.toLowerCase() !== host.toLowerCase()) {
      return errorResponse(403, "forbidden");
    }
  }
  return null;
}
