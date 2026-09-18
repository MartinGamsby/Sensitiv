// The worker's outbound HTTP seam, for adapters that read an API instead of
// driving a browser.
//
// The default FAILS CLOSED under the test runner, exactly like the Solari
// module loader in `browser/solari.ts` and for exactly the same reason: "zero
// network calls in tests" (memory/running-and-testing.md) is too important to
// leave to per-test discipline. An adapter that forgot to take the injected
// fetch would otherwise reach a real third-party endpoint from CI, and the
// failure would be invisible — a green suite that quietly depends on the
// internet. Every caller already treats a fetch failure as "fall back to the
// fixture", so refusing here degrades rather than crashes.
export type FetchLike = typeof fetch;

/** Message the test-runner guard rejects with. Exported so a test can assert on
 *  the guard itself rather than matching prose. */
export const NETWORK_DISABLED_MESSAGE =
  "outbound HTTP is disabled under the test runner — inject a fetch via RunJobDeps.fetchImpl or AdapterContext.fetch";

export function defaultAdapterFetch(): FetchLike {
  if (process.env.VITEST || process.env.NODE_ENV === "test") {
    return () => Promise.reject(new Error(NETWORK_DISABLED_MESSAGE));
  }
  return globalThis.fetch.bind(globalThis);
}
