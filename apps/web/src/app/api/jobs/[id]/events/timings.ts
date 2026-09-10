// Sidecar for `route.ts`: a Next.js route module may only export the recognised
// handler/config names, so the tunable SSE cadence and its test-only setter
// live here instead.

export const sseTimings = { pollMs: 500, heartbeatMs: 15_000 };

/** TEST ONLY — shorten the poll/heartbeat cadence so tests don't wait seconds. */
export function __setSseTimings(
  next: { pollMs?: number; heartbeatMs?: number } | undefined,
): void {
  sseTimings.pollMs = next?.pollMs ?? 500;
  sseTimings.heartbeatMs = next?.heartbeatMs ?? 15_000;
}
