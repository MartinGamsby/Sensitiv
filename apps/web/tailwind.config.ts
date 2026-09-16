import colors from "tailwindcss/colors";
import type { Config } from "tailwindcss";

/** `--token` holding space-separated RGB channels -> an alpha-aware color. */
const token = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

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
        // Semantic tone families for `Badge`/`Card`. Each aliases a Tailwind
        // scale so a tone can be repainted in one place.
        neutral: colors.slate,
        ok: colors.emerald,
        warn: colors.amber,
        danger: colors.red,
        info: colors.sky,

        // Structural tokens — these resolve through the CSS variables in
        // `globals.css`, so `bg-surface` is automatically light/dark aware and
        // callers no longer need a `dark:` twin for every colour.
        bg: token("bg"),
        surface: token("surface"),
        "surface-muted": token("surface-muted"),
        "border-subtle": token("border-subtle"),
        "border-strong": token("border-strong"),
        fg: token("fg"),
        "fg-muted": token("fg-muted"),
        "fg-subtle": token("fg-subtle"),

        brand: {
          DEFAULT: token("brand"),
          hover: token("brand-hover"),
          fg: token("brand-fg"),
          soft: token("brand-soft"),
          "soft-fg": token("brand-soft-fg"),
        },
      },
      boxShadow: {
        // Two elevations only: a resting card and a raised/hover one. Tuned
        // soft so they read on the near-white page without looking stamped on.
        card: "0 1px 2px 0 rgb(15 23 42 / 0.04), 0 1px 3px 0 rgb(15 23 42 / 0.06)",
        raised: "0 4px 6px -2px rgb(15 23 42 / 0.06), 0 12px 20px -8px rgb(15 23 42 / 0.12)",
      },
      keyframes: {
        "fade-in-up": {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "pulse-ring": {
          "0%": { transform: "scale(0.9)", opacity: "0.7" },
          "70%": { transform: "scale(1.6)", opacity: "0" },
          "100%": { transform: "scale(1.6)", opacity: "0" },
        },
      },
      animation: {
        "fade-in-up": "fade-in-up 180ms ease-out both",
        "pulse-ring": "pulse-ring 1.8s ease-out infinite",
      },
    },
  },
  plugins: [],
} satisfies Config;
