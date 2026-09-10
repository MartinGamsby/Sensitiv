import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    // The runner/E2E tests touch a real (in-memory) libsql database and bind a
    // loopback port — keep files serial so nothing races on a shared resource.
    fileParallelism: false,
  },
});
