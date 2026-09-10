import type { Config } from "tailwindcss";

export default {
  content: [
    "./src/**/*.{ts,tsx,mdx}",
    // Scan the shared package too, in case shared components land later.
    // Scoped to source dirs so the glob never walks packages/*/node_modules.
    "../../packages/*/src/**/*.{ts,tsx}",
    "../../packages/*/catalog/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
} satisfies Config;
