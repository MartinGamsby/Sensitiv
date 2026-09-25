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

/**
 * Split into `count` chunks whose sizes differ by at most one, preserving
 * order. For work whose time grows with chunk size (an LLM call grows with the
 * places it has to answer for), 4+4+4 finishes sooner than 8+4.
 */
export function splitEvenly<T>(items: readonly T[], count: number): T[][] {
  const n = Math.max(1, Math.min(items.length, Math.floor(count)));
  if (items.length === 0) return [];
  const out: T[][] = [];
  const base = Math.floor(items.length / n);
  const extra = items.length % n;
  let at = 0;
  for (let i = 0; i < n; i++) {
    const size = base + (i < extra ? 1 : 0);
    out.push(items.slice(at, at + size));
    at += size;
  }
  return out;
}

/** Split into fixed-size chunks, preserving order. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += Math.max(1, size)) {
    out.push(items.slice(i, i + Math.max(1, size)));
  }
  return out;
}

// `isSafeSiteUrl` / `isSafePhotoUrl` moved to `@sensitiv/shared` when the Next
// photo route became a second caller. Re-exported here so every adapter's
// import keeps working and there is still only ONE implementation of each
// check — see the header of `packages/shared/src/safe-url.ts`.
export { isSafePhotoUrl, isSafeSiteUrl, safePhotoUrl } from "@sensitiv/shared/safe-url";
