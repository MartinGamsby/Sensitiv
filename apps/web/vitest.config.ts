import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Route-handler tests only. Next's own files (`route.ts`, `page.tsx`) are not
    // tests; the `*.test.ts` files colocated under `src/app/api` are.
    include: ["src/**/*.test.ts"],
    environment: "node",
    // Every test opens its own in-memory libsql database and some bind timers;
    // keep files serial so nothing races on a shared resource.
    fileParallelism: false,
  },
});
