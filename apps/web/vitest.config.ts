import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const srcDir = resolve(dirname(fileURLToPath(import.meta.url)), "src");

export default defineConfig({
  // The app's tsconfig uses `jsx: "preserve"` for Next; tests need a real
  // transform. Use the automatic runtime so test files don't import React.
  esbuild: { jsx: "automatic", jsxImportSource: "react" },
  // Mirror tsconfig `paths`: `@/*` -> `src/*` (Next resolves this itself; vitest
  // needs it spelled out).
  resolve: {
    alias: [{ find: /^@\//, replacement: `${srcDir}/` }],
  },
  test: {
    // Route-handler tests (`src/app/api/**/*.test.ts`) run in Node; component and
    // hook tests (`*.test.tsx`, `src/hooks/**`) need a DOM.
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    environmentMatchGlobs: [
      ["src/**/*.test.tsx", "jsdom"],
      ["src/hooks/**/*.test.ts", "jsdom"],
    ],
    // Every route-handler test opens its own in-memory libsql database and some
    // bind timers; keep files serial so nothing races on a shared resource.
    fileParallelism: false,
  },
});
