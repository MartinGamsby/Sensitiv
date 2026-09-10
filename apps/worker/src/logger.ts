// Structured job logger: every call writes a `job_events` row (the product —
// the run page is a narrative of these) AND a stdout line. It NEVER receives a
// secret: callers pass already-safe messages, and nothing here serializes env.
import { appendEvent, type DbHandle, type JobEventLevel } from "@sensitiv/db";

export type JobLogLevel = JobEventLevel; // "debug" | "info" | "warn" | "error"

export type JobLogFn = (
  level: JobLogLevel,
  message: string,
  source?: string,
) => Promise<void>;

export type JobLogger = JobLogFn & { readonly count: number };

export interface JobLoggerOptions {
  /** Where the mirrored line goes. Defaults to `process.stdout`. */
  sink?: (line: string) => void;
}

/** Build a logger bound to one job id. */
export function createJobLogger(
  db: DbHandle,
  jobId: string,
  opts: JobLoggerOptions = {},
): JobLogger {
  const sink =
    opts.sink ?? ((line: string) => void process.stdout.write(`${line}\n`));
  let count = 0;

  const fn: JobLogFn = async (level, message, source) => {
    count += 1;
    try {
      await appendEvent(db, jobId, level, message, source);
    } catch (err) {
      sink(`[job ${jobId}] event-write-failed: ${String(err)}`);
    }
    sink(`[job ${jobId}] ${level}${source ? ` (${source})` : ""} ${message}`);
  };

  Object.defineProperty(fn, "count", { get: () => count });
  return fn as JobLogger;
}
