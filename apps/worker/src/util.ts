// Small shared helpers for the worker. No I/O, no domain logic.

/**
 * Replace every non-empty secret in `text` with `***`. The one place the
 * "a secret never reaches a job_events row, error_text, or stdout" invariant is
 * actually enforced — callers hand errors from third-party SDKs (whose error
 * shapes we do not control) straight into the logger and the `error_text`
 * column, so scrubbing has to happen at the sink, not at each call site.
 */
export function scrubSecrets(
  text: string,
  secrets: readonly (string | undefined)[],
): string {
  let out = text;
  for (const secret of secrets) {
    if (secret && secret.length > 0) out = out.split(secret).join("***");
  }
  return out;
}

/** Human-readable error string. `secret`, when given, is scrubbed to `***`. */
export function describeError(err: unknown, secret?: string): string {
  const message =
    err instanceof Error
      ? `${err.name}: ${err.message}`
      : typeof err === "string"
        ? err
        : JSON.stringify(err);
  return scrubSecrets(message, [secret]);
}

/** True for aborts raised by an `AbortSignal` / the LLM seam / the job budget. */
export function isAbortError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name === "AbortError") return true;
  const kind = (err as { kind?: unknown }).kind;
  if (err.name === "LlmError" && kind === "abort") return true;
  return /\babort(ed)?\b|budget exceeded/i.test(err.message);
}

export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function dedupe(items: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const trimmed = item.trim();
    if (trimmed === "" || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    t.unref?.();
  });
}

/**
 * Run `worker` over `items` with at most `limit` in flight, preserving input
 * order in the result.
 *
 * A fixed pool of `limit` loops pulling from a shared cursor, not
 * `chunk().map(Promise.all)`: batching would idle the whole pool waiting on the
 * slowest member of each batch, and the slowest LLM extraction in a run can be
 * three times the median.
 *
 * Rejections propagate — callers that must not fail the job catch inside
 * `worker`, which is what both call sites do.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const pool = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index] as T, index);
    }
  });
  await Promise.all(pool);
  return results;
}

/** Split into fixed-size chunks, preserving order. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += Math.max(1, size)) {
    out.push(items.slice(i, i + Math.max(1, size)));
  }
  return out;
}

/**
 * Whether the worker may open a URL that came off a third-party page.
 *
 * Adapters read URLs out of content they did not author — a business website
 * scraped off a Maps detail panel, a `website=` tag someone typed into
 * OpenStreetMap — and then either navigate to it or store it as an `href`.
 * That is the one class of URL in this codebase not built from our own
 * constants. Absolute http(s) only, and never an address that resolves inside
 * an infrastructure network: the browser doing the fetching sits in Solari's
 * estate, and "open whatever the page says" is how a scraper becomes someone
 * else's SSRF tool.
 *
 * Lives here rather than in one adapter because more than one adapter needs it
 * now, and a security check copied per call site is a check that drifts.
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
