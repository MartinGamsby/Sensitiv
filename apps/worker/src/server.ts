// The worker's HTTP surface. Loopback only (127.0.0.1) — this process holds
// secrets and has no auth by design.
//   POST /jobs   { jobId, solariKey? }  -> 202 immediately, run in the background
//   GET  /healthz                       -> { ok, solari: boolean, llm: "anthropic"|"fake" }
// A BYOK `solariKey` lives in a local variable for that job only: never written
// to the DB, never logged, never attached to replay metadata, dropped on finish.
// Invariant: a claimed job ALWAYS reaches a terminal status. Anything `runJob`
// throws — including before it can mark the row `running` — is caught here and
// finished as `error`, and the poll loop never re-claims an id it has attempted.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  appendEvent,
  finishJob,
  getDb,
  listQueuedJobs,
  listRunningJobs,
  type DbHandle,
} from "@sensitiv/db";
import {
  hasAnthropicKey,
  hasSolariKey,
  loadEnv,
  type Env,
} from "@sensitiv/shared/env";
import { runJob } from "./runner.ts";
import { describeError, scrubSecrets, truncate } from "./util.ts";

/** `error_text` is shown in the UI — long enough to diagnose, bounded anyway. */
const MAX_ERROR_TEXT = 2_000;

export interface WorkerServer {
  port: number;
  url: string;
  close(): Promise<void>;
}

export interface StartServerOptions {
  port?: number;
  /** Poll the DB for `queued` jobs and claim them. Off by default (tests). */
  poll?: boolean;
  pollIntervalMs?: number;
  /** Injected in tests; falls back to the `getDb()` singleton. */
  db?: DbHandle;
  env?: Env;
  /** Injected in tests; the real `runJob` otherwise. */
  runJob?: typeof runJob;
}

export async function startServer(
  opts: StartServerOptions = {},
): Promise<WorkerServer> {
  const env = opts.env ?? loadEnv();
  const db = opts.db ?? (await getDb()).db;
  const port = opts.port ?? env.WORKER_PORT;

  const run = opts.runJob ?? runJob;

  const inFlight = new Set<string>();
  /**
   * Every job this process has ever claimed. The poll loop never claims one
   * twice: if a run threw before the row could be moved off `queued`, the row
   * still reads `queued` and the loop would otherwise re-claim it every tick,
   * forever. One id string per job, on a localhost single-user app — the growth
   * is not worth a bound.
   */
  const attempted = new Set<string>();
  let chain: Promise<unknown> = Promise.resolve();

  /** Any secret that could have been interpolated into an error message. */
  const scrub = (err: unknown, byokKey?: string): string =>
    scrubSecrets(describeError(err), [
      byokKey,
      env.SOLARI_API_KEY,
      env.ANTHROPIC_API_KEY,
    ]);

  const enqueue = (jobId: string, solariKey?: string): void => {
    if (inFlight.has(jobId)) return;
    inFlight.add(jobId);
    attempted.add(jobId);
    let key: string | undefined = solariKey;
    chain = chain.then(async () => {
      try {
        await run(db, jobId, { solariKey: key });
      } catch (err) {
        // `runJob` writes its own terminal state for anything thrown inside its
        // try, but a throw BEFORE `markJobRunning` (a bad LLM_PROVIDER, a
        // `loadEnv` failure, a deleted row) escapes to here — and would leave
        // the row `queued`, i.e. non-terminal and re-claimed on the next tick.
        // Every claimed job ends terminal: whatever escapes lands as `error`.
        const text = scrub(err, key);
        process.stderr.write(`[worker] job ${jobId} crashed: ${text}\n`);
        try {
          await finishJob(db, jobId, "error", truncate(text, MAX_ERROR_TEXT));
        } catch (markErr) {
          // The DB itself is unhappy; `attempted` is what stops the spin now.
          process.stderr.write(
            `[worker] job ${jobId} could not be marked error: ${scrub(markErr, key)}\n`,
          );
        }
      } finally {
        key = undefined; // drop the BYOK key the moment the job ends
        inFlight.delete(jobId);
      }
    });
  };

  const server = createServer((req, res) => {
    void handle(req, res).catch((err: unknown) => {
      writeJson(res, 500, { error: describeError(err) });
    });
  });

  async function handle(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    if (req.method === "GET" && req.url === "/healthz") {
      writeJson(res, 200, {
        ok: true,
        solari: hasSolariKey(env),
        llm: hasAnthropicKey(env) ? "anthropic" : "fake",
      });
      return;
    }

    if (req.method === "POST" && req.url === "/jobs") {
      // Loopback + no auth means the ONLY thing standing between this endpoint
      // and any web page the user happens to have open is the browser. A
      // cross-origin `fetch` with `content-type: text/plain` is a "simple"
      // request — no preflight — and `JSON.parse` below does not care about the
      // content type, so such a page could drive this endpoint. Browsers always
      // attach `Origin` to a cross-origin request; the only legitimate caller
      // (the Next server, via `postJobToWorker`) never sends one. Refuse
      // anything that carries it rather than replying with CORS headers.
      if (req.headers.origin !== undefined) {
        writeJson(res, 403, { error: "cross-origin requests are not accepted" });
        return;
      }
      let body: unknown;
      try {
        body = JSON.parse(await readBody(req));
      } catch {
        writeJson(res, 400, { error: "invalid JSON body" });
        return;
      }
      const jobId = (body as { jobId?: unknown }).jobId;
      const solariKeyRaw = (body as { solariKey?: unknown }).solariKey;
      if (typeof jobId !== "string" || jobId === "") {
        writeJson(res, 400, { error: "jobId is required" });
        return;
      }
      writeJson(res, 202, { accepted: true, jobId });
      enqueue(
        jobId,
        typeof solariKeyRaw === "string" && solariKeyRaw !== ""
          ? solariKeyRaw
          : undefined,
      );
      return;
    }

    writeJson(res, 404, { error: "not found" });
  }

  await new Promise<void>((resolve) => {
    server.listen(port, "127.0.0.1", resolve);
  });
  const address = server.address();
  const boundPort =
    typeof address === "object" && address ? address.port : port;

  // A job only leaves `running` in the process that claimed it, so any row
  // still `running` when a NEW process starts was abandoned by a dead one — a
  // crash, a deploy, or `tsx watch` restarting on a source edit. Nothing else
  // would ever finish it: the poll loop claims only `queued`, and the
  // `JobBudget` that would have timed it out died with its process. Left alone
  // the run page spins forever, which is exactly what it did.
  await reapAbandonedJobs(db, scrub);

  let pollTimer: ReturnType<typeof setInterval> | undefined;
  if (opts.poll) {
    pollTimer = setInterval(() => {
      void (async () => {
        try {
          for (const job of await listQueuedJobs(db, 5)) {
            if (attempted.has(job.id)) continue;
            enqueue(job.id);
          }
        } catch (err) {
          process.stderr.write(`[worker] poll failed: ${scrub(err)}\n`);
        }
      })();
    }, opts.pollIntervalMs ?? 1_000);
    pollTimer.unref?.();
  }

  return {
    port: boundPort,
    url: `http://127.0.0.1:${boundPort}`,
    async close() {
      if (pollTimer) clearInterval(pollTimer);
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
      await chain.catch(() => undefined);
    },
  };
}

function writeJson(res: ServerResponse, status: number, payload: unknown): void {
  const text = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(text),
  });
  res.end(text);
}

function readBody(req: IncomingMessage, limitBytes = 64 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > limitBytes) {
        reject(new Error("request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/**
 * Finish every job left `running` by a previous process.
 *
 * Sound only because Sensitiv runs a single worker: a process that has just
 * started owns no running job, so everything here is abandoned. Best-effort —
 * a failure to reap must never stop the worker from coming up.
 */
async function reapAbandonedJobs(
  db: DbHandle,
  // Passed in rather than re-derived: `startServer`'s closure is what knows
  // which secrets are in play for this process.
  scrub: (err: unknown) => string,
): Promise<void> {
  try {
    const abandoned = await listRunningJobs(db);
    for (const job of abandoned) {
      const message =
        "the worker restarted while this run was in progress, so it was stopped";
      // An event row too, not just the status: the run page reads the log, and
      // "it stopped because the worker restarted" is the one thing a user
      // staring at a dead spinner actually wants to know.
      try {
        await appendEvent(db, job.id, "error", message);
      } catch {
        /* the status below is what matters */
      }
      await finishJob(db, job.id, "error", message);
      process.stderr.write(`[worker] reaped abandoned job ${job.id}
`);
    }
  } catch (err) {
    process.stderr.write(`[worker] could not reap abandoned jobs: ${scrub(err)}
`);
  }
}
