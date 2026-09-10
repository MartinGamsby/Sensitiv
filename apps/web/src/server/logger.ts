// The web server's logger. Deliberately tiny and deliberately the ONLY thing the
// route handlers log through, so "no secret ever reaches a log line" is a single
// reviewable rule. Callers must never pass a BYOK key, an API key, or a raw
// upstream body here.

export type LogLevel = "info" | "warn" | "error";

function emit(level: LogLevel, message: string): void {
  const line = `[web] ${message}`;
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
}

export const logger = {
  info: (message: string) => emit("info", message),
  warn: (message: string) => emit("warn", message),
  error: (message: string) => emit("error", message),
};

/** Human-readable error text. Never includes request bodies or secrets. */
export function describeError(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return "unknown error";
  }
}
