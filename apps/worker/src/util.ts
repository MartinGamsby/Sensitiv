// Small shared helpers for the worker. No I/O, no domain logic.

/** Human-readable error string. `secret`, when given, is scrubbed to `***`. */
export function describeError(err: unknown, secret?: string): string {
  let message =
    err instanceof Error
      ? `${err.name}: ${err.message}`
      : typeof err === "string"
        ? err
        : JSON.stringify(err);
  if (secret && secret.length > 0) {
    message = message.split(secret).join("***");
  }
  return message;
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
