// Sidecar for `route.ts`: a Next.js route module may only export the recognised
// handler/config names, so the process-wide rate-limit window and its
// test-only reset live here instead.

export const geocodeRateLimit = { lastRequestAt: 0 };

/** TEST ONLY — reset the process rate-limit window between cases. */
export function __resetGeocodeRateLimit(): void {
  geocodeRateLimit.lastRequestAt = 0;
}
