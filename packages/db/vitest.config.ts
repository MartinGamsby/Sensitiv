import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    // Repo round-trips touch a real (in-memory) libsql database; keep them serial
    // per file so a shared temp dir is never a race.
    fileParallelism: false,
  },
});
