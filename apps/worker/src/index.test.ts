import { describe, expect, it } from "vitest";

// Placeholder so `pnpm -r --parallel test` has something to run in apps/worker
// until Section 7 adds the real job-runner tests. Importing src/index.ts here
// would call process.exit(0), so this stays standalone.
describe("worker scaffold", () => {
  it("workspace + vitest wiring is alive", () => {
    expect(1 + 1).toBe(2);
  });
});
