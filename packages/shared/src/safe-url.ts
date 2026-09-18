// URL gates for addresses that came off a page we did not author.
//
// These live in `shared` rather than in either app because BOTH sides need the
// same answer and a security check copied per call site is a check that
// drifts (the same reasoning that moved `isSafeSiteUrl` out of the Google Maps
// adapter, and that keeps `resolveStoredReplayPath` in one place). The worker
// decides whether a scraped URL may be STORED; the Next photo route decides
// whether a stored URL may be FETCHED. One function, asked twice.
//
// See `memory/security-invariants.md`.

/**
 * Whether an address may be opened at all: absolute http(s), and never
 * something that resolves inside an infrastructure network.
 *
 * Adapters read URLs out of content they did not author — a business website
 * scraped off a Maps detail panel, a `website=` tag someone typed into
 * OpenStreetMap — and then navigate to it or store it as an `href`. "Open
 * whatever the page says" is how a scraper becomes someone else's SSRF tool.
 *
 * What this does NOT do is resolve DNS, so a public hostname that answers
 * `127.0.0.1` still passes. That residual is accepted rather than overlooked:
 * closing it means resolving and pinning an address per request, and the
 * payoff for an attacker on a single-user localhost install is a page the
 * reader's own browser could already fetch.
 */
export function isSafeSiteUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "" || host === "localhost" || host.endsWith(".localhost")) return false;
  if (host.endsWith(".local") || host.endsWith(".internal")) return false;
  if (host === "::1" || host.startsWith("fc") || host.startsWith("fd")) return false;
  // Bare IPv4 literals: allow nothing private, link-local or loopback. A public
  // IPv4 literal is not a normal website address either, so reject the lot.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false;
  return true;
}

/**
 * Whether a URL may be stored as a PHOTO of a place — and therefore fetched
 * later, by our own server, on a reader's behalf.
 *
 * Stricter than `isSafeSiteUrl` in two ways, both deliberate. https only: a
 * photo is never something the reader chose to open, so there is no reason to
 * carry one over plaintext. And no credentials: a URL with a userinfo part is
 * not a photo URL, whatever else it is.
 *
 * It is LOOSER than the rule it replaced, which accepted only
 * `*.googleusercontent.com` — and that narrowness was the bug. A place Google
 * Maps has no photo carousel for showed no picture at all, however good the
 * one on its own website. Widening the host set is only safe because a stored
 * URL is no longer an `<img src>` the reader's browser resolves:
 * `/api/jobs/:id/places/:key/photo` fetches it server-side, re-validates with
 * this same function, and serves the bytes from our own origin.
 */
export function isSafePhotoUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (url.username !== "" || url.password !== "") return false;
  return isSafeSiteUrl(url.href);
}

/** `isSafePhotoUrl` as a filter: the trimmed URL, or nothing. */
export function safePhotoUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  return isSafePhotoUrl(trimmed) ? trimmed : undefined;
}
