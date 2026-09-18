/**
 * A stand-in App Router for component tests.
 *
 * `next/navigation`'s hooks throw "invariant expected app router to be
 * mounted" outside a real Next tree, and the dossier now reads the URL
 * (`useSearchParams`) and pushes to it (`Link`, `router.back`). Rather than
 * each test file inventing its own mock, `vitest.setup.ts` installs this one
 * globally and tests drive it through `setSearchParams` / `routerCalls`.
 */
const state = { search: new URLSearchParams() };

/** Calls the component under test made on the router, in order. */
export const routerCalls: Array<{ method: string; arg?: string }> = [];

/** What the mocked `useSearchParams` should report right now. Read at render
 *  time, not at mock time, so `setSearchParams` between renders takes. */
export function currentSearchParams(): URLSearchParams {
  return state.search;
}

/** Set the query string the mocked `useSearchParams` reports. */
export function setSearchParams(query: string): void {
  state.search = new URLSearchParams(query);
}

/** Reset both, between tests. */
export function resetRouter(): void {
  state.search = new URLSearchParams();
  routerCalls.length = 0;
}

export const mockRouter = {
  back: () => {
    routerCalls.push({ method: "back" });
    // A real `back()` would restore the previous URL; tests that care about
    // what the reader ends up looking at say so by calling `setSearchParams`
    // themselves, so this only records the intent.
  },
  forward: () => routerCalls.push({ method: "forward" }),
  push: (href: string) => {
    routerCalls.push({ method: "push", arg: href });
  },
  replace: (href: string) => routerCalls.push({ method: "replace", arg: href }),
  refresh: () => routerCalls.push({ method: "refresh" }),
  prefetch: () => undefined,
};
