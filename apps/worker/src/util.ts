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
