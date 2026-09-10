// Structured job logger: every call writes a `job_events` row (the product —
// the run page is a narrative of these) AND a stdout line. Callers pass
// already-safe messages, and nothing here serializes env — but a message can
// carry a stringified third-party SDK error whose shape we do not control, so
// `redact` scrubs every configured secret here, at the sink, before the message
// can reach SQLite or stdout. Both destinations are covered by one pass.
import { appendEvent, type DbHandle, type JobEventLevel } from "@sensitiv/db";
import { scrubSecrets } from "./util.ts";

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
  /**
   * Secret values to replace with `***` in EVERY message, before it is written
   * to `job_events` or mirrored to the sink. Typically the BYOK Solari key plus
   * `SOLARI_API_KEY` / `ANTHROPIC_API_KEY`.
   */
  redact?: readonly (string | undefined)[];
}

/** Build a logger bound to one job id. */
export function createJobLogger(
  db: DbHandle,
  jobId: string,
  opts: JobLoggerOptions = {},
): JobLogger {
  const sink =
    opts.sink ?? ((line: string) => void process.stdout.write(`${line}\n`));
  const redact = opts.redact ?? [];
  let count = 0;

  const fn: JobLogFn = async (level, rawMessage, source) => {
    count += 1;
    const message = scrubSecrets(rawMessage, redact);
    try {
      await appendEvent(db, jobId, level, message, source);
    } catch (err) {
      sink(
        `[job ${jobId}] event-write-failed: ${scrubSecrets(String(err), redact)}`,
      );
    }
    sink(`[job ${jobId}] ${level}${source ? ` (${source})` : ""} ${message}`);
  };

  Object.defineProperty(fn, "count", { get: () => count });
  return fn as JobLogger;
}
