import { describeError, logger } from "./logger.ts";

/** Worker `POST /jobs` must answer within this window or we give up and let the
 * worker's SQLite poll loop claim the job instead. */
export const WORKER_ENQUEUE_TIMEOUT_MS = 3_000;

export interface PostJobToWorkerArgs {
  jobId: string;
  /** BYOK Solari key. TRANSPORT ONLY — forwarded in the request body and then
   * dropped. It is never persisted, never logged, never returned to the client. */
  solariKey?: string;
  workerUrl: string;
  fetchImpl?: typeof fetch;
}

export interface PostJobToWorkerResult {
  /** `true` only when the worker accepted the job over HTTP. `false` means the
   * job stays `queued` and the worker poll loop will pick it up. */
  delivered: boolean;
}

/**
 * Best-effort, fire-and-forget job start. Any failure (worker down, timeout,
 * non-2xx) is swallowed with a warning: the job row already exists in `queued`
 * status and the worker polls for those. We never surface a worker error to the
 * user.
 */
export async function postJobToWorker(
  args: PostJobToWorkerArgs,
): Promise<PostJobToWorkerResult> {
  const fetchImpl = args.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const base = args.workerUrl.replace(/\/+$/, "");
  // The Solari key goes into the body ONLY. It is intentionally absent from the
  // URL, the headers, and every log line below.
  const body = args.solariKey
    ? { jobId: args.jobId, solariKey: args.solariKey }
    : { jobId: args.jobId };

  try {
    const res = await fetchImpl(`${base}/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(WORKER_ENQUEUE_TIMEOUT_MS),
    });
    if (!res.ok) {
      logger.warn(
        `worker enqueue for job ${args.jobId} returned HTTP ${res.status}; leaving it queued`,
      );
      return { delivered: false };
    }
    return { delivered: true };
  } catch (err) {
    logger.warn(
      `worker enqueue for job ${args.jobId} failed (${describeError(err)}); leaving it queued`,
    );
    return { delivered: false };
  }
}
