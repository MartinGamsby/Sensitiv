// GET /api/jobs/:id/events — Server-Sent Events tail of the `job_events` table.
//
// The browser never talks to the worker. The worker appends `job_events` rows to
// SQLite; this handler polls that table with an id cursor and streams each new
// row as an SSE frame, then closes when the job reaches a terminal status.
import { getJob, listEventsAfter } from "@sensitiv/db";
import { getWebDeps } from "../../../../../server/deps.ts";
import { errorResponse } from "../../../../../server/http.ts";
import { describeError, logger } from "../../../../../server/logger.ts";
import { getCurrentUser } from "../../../../../server/user.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TERMINAL = new Set(["done", "partial", "error"]);

let pollMs = 500;
let heartbeatMs = 15_000;

/** TEST ONLY — shorten the poll/heartbeat cadence so tests don't wait seconds. */
export function __setSseTimings(
  next: { pollMs?: number; heartbeatMs?: number } | undefined,
): void {
  pollMs = next?.pollMs ?? 500;
  heartbeatMs = next?.heartbeatMs ?? 15_000;
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { db } = await getWebDeps();
  const { id } = await ctx.params;
  const user = await getCurrentUser();

  const job = await getJob(db, id, user.id);
  if (!job) return errorResponse(404, "not found");

  // Cursor: `Last-Event-ID` header wins, then `?after=`, then 0.
  const url = new URL(req.url);
  const headerCursor = Number(req.headers.get("last-event-id"));
  const queryCursor = Number(url.searchParams.get("after"));
  let cursor = Number.isFinite(headerCursor) && headerCursor > 0
    ? headerCursor
    : Number.isFinite(queryCursor) && queryCursor > 0
      ? queryCursor
      : 0;

  const encoder = new TextEncoder();
  let poll: ReturnType<typeof setInterval> | undefined;
  let beat: ReturnType<typeof setInterval> | undefined;
  let done = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (frame: string): void => {
        if (done) return;
        try {
          controller.enqueue(encoder.encode(frame));
        } catch {
          stop();
        }
      };

      const stop = (): void => {
        if (done) return;
        done = true;
        if (poll) clearInterval(poll);
        if (beat) clearInterval(beat);
        req.signal.removeEventListener("abort", stop);
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      const tick = async (): Promise<void> => {
        if (done) return;
        try {
          const events = await listEventsAfter(db, id, cursor, 200);
          for (const event of events) {
            send(
              `id: ${event.id}\nevent: job-event\ndata: ${JSON.stringify(event)}\n\n`,
            );
            cursor = event.id;
          }
          const current = await getJob(db, id, user.id);
          if (current && TERMINAL.has(current.status)) {
            send(
              `event: job-status\ndata: ${JSON.stringify({ status: current.status })}\n\n`,
            );
            stop();
          }
        } catch (err) {
          logger.warn(`SSE tail for job ${id} failed: ${describeError(err)}`);
          stop();
        }
      };

      // Client already gone before we started.
      if (req.signal.aborted) {
        stop();
        return;
      }
      req.signal.addEventListener("abort", stop);

      // An immediate status frame so the UI shows `queued` rather than a blank
      // panel when the worker has not produced any events yet.
      send(
        `event: job-status\ndata: ${JSON.stringify({ status: job.status })}\n\n`,
      );

      void tick();
      poll = setInterval(() => void tick(), pollMs);
      poll.unref?.();
      beat = setInterval(() => send(`: heartbeat\n\n`), heartbeatMs);
      beat.unref?.();
    },
    cancel() {
      done = true;
      if (poll) clearInterval(poll);
      if (beat) clearInterval(beat);
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
