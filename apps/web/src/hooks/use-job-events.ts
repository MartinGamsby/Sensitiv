"use client";

import { useEffect, useRef, useState } from "react";
import { JobEventSchema, type JobEvent, type JobStatus } from "@sensitiv/shared";

export type LiveStatus = JobStatus | "connecting";

export interface UseJobEventsResult {
  events: JobEvent[];
  status: LiveStatus;
}

const TERMINAL = new Set<JobStatus>(["done", "partial", "error"]);

/**
 * Tails `GET /api/jobs/:id/events` over `EventSource`. Appends `job-event`
 * frames, tracks the latest `job-status`, and closes the connection once the
 * job reaches a terminal status. Reconnection (if the stream drops early) rides
 * on the browser's native `Last-Event-ID` mechanism — we never re-fetch from 0.
 */
export function useJobEvents(jobId: string): UseJobEventsResult {
  const [events, setEvents] = useState<JobEvent[]>([]);
  const [status, setStatus] = useState<LiveStatus>("connecting");
  const sourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!jobId) return;
    // StrictMode mounts effects twice in dev; never hold two connections.
    if (sourceRef.current) return;

    const es = new EventSource(`/api/jobs/${encodeURIComponent(jobId)}/events`);
    sourceRef.current = es;

    const onEvent = (e: MessageEvent) => {
      try {
        const parsed = JobEventSchema.safeParse(JSON.parse(e.data));
        if (!parsed.success) return;
        const next = parsed.data;
        setEvents((prev) =>
          prev.some((p) => p.id === next.id) ? prev : [...prev, next],
        );
      } catch {
        /* ignore a malformed frame */
      }
    };

    const onStatus = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as { status?: JobStatus };
        if (!data.status) return;
        setStatus(data.status);
        if (TERMINAL.has(data.status)) {
          es.close();
          sourceRef.current = null;
        }
      } catch {
        /* ignore */
      }
    };

    es.addEventListener("job-event", onEvent as EventListener);
    es.addEventListener("job-status", onStatus as EventListener);

    return () => {
      es.removeEventListener("job-event", onEvent as EventListener);
      es.removeEventListener("job-status", onStatus as EventListener);
      es.close();
      sourceRef.current = null;
    };
  }, [jobId]);

  return { events, status };
}
