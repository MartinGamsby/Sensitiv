import colors from "tailwindcss/colors";
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
    extend: {
      colors: {
        // Semantic tone families for `Badge`/`Card` — each aliases an
        // existing Tailwind scale so `bg-warn-100 dark:bg-warn-950` etc.
        // resolve to the exact same colors the ad-hoc `bg-amber-100
        // dark:bg-amber-950` strings did. One place to repaint a tone later.
        neutral: colors.gray,
        ok: colors.emerald,
        warn: colors.amber,
        danger: colors.red,
        info: colors.blue,
        // Flat structural tokens for card surfaces and body text, so
        // components stop repeating `bg-gray-50` / `text-gray-500` inline.
        surface: colors.white,
        "surface-muted": colors.gray[50],
        "border-subtle": colors.gray[200],
        fg: colors.gray[900],
        "fg-muted": colors.gray[500],
      },
    },
  },
  plugins: [],
} satisfies Config;
