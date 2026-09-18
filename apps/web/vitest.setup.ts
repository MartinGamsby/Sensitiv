// Global test setup for the web app.
//
// `next/navigation`'s hooks throw "invariant expected app router to be
// mounted" outside a real Next tree, and enough components now read the URL
// that mocking it per file was pure repetition. Hoisted here so every
// component test gets the same router; a test that cares about the URL drives
// it through `setSearchParams` in `test-support/router.ts`.
import { afterEach, vi } from "vitest";

vi.mock("next/navigation", async () => {
  const mod = await import("./src/test-support/router.ts");
  return {
    useRouter: () => mod.mockRouter,
    // Called per render, so a `setSearchParams` between renders takes effect.
    useSearchParams: () => mod.currentSearchParams(),
    usePathname: () => "/jobs/job-1",
    notFound: () => {
      throw new Error("notFound");
    },
  };
});

// The mocked router is module state shared by every test in a file; reset it
// so one test's `?place=` cannot leak into the next.
afterEach(async () => {
  const { resetRouter } = await import("./src/test-support/router.ts");
  resetRouter();
});
