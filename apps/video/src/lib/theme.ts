// The app's design tokens, as plain colours. Copied from `apps/web/src/app/
// globals.css` (the structural tokens) and the Tailwind scales the app's
// `Badge`, `Card`, `RankMedal` and status card use — keep them in step when
// the app is repainted.

export type ThemeName = "dark" | "light";

export interface Tone {
  bg: string;
  fg: string;
}

export interface Theme {
  name: ThemeName;
  bg: string;
  surface: string;
  surfaceMuted: string;
  borderSubtle: string;
  borderStrong: string;
  fg: string;
  fgMuted: string;
  fgSubtle: string;
  brand: string;
  brandHover: string;
  brandFg: string;
  brandSoft: string;
  brandSoftFg: string;
  /** `brand` as raw channels, for alpha: `rgb(${t.brandRgb} / 0.2)`. */
  brandRgb: string;
  bgRgb: string;
  shadowCard: string;
  shadowRaised: string;
  badge: Record<"neutral" | "ok" | "warn" | "danger" | "info" | "brand", Tone>;
  status: Record<"running" | "done", { border: string; bg: string; accent: string }>;
  medal: Record<1 | 2 | 3, { border: string; bg: string; fg: string; laurel: string }>;
  /** Delta colours in the score breakdown. */
  positive: string;
  negative: string;
  /** Applied to raster tiles: the app inverts them for dark mode. */
  mapFilter: string;
  /** Behind the video itself, outside the fake browser. */
  stage: { base: string; glowA: string; glowB: string; glowC: string; grid: string };
  /** Caption glass. */
  glass: string;
  glassBorder: string;
}

export const DARK: Theme = {
  name: "dark",
  bg: "rgb(9 14 26)",
  surface: "rgb(17 24 39)",
  surfaceMuted: "rgb(24 33 51)",
  borderSubtle: "rgb(39 51 73)",
  borderStrong: "rgb(55 71 97)",
  fg: "rgb(241 245 249)",
  fgMuted: "rgb(148 163 184)",
  fgSubtle: "rgb(100 116 139)",
  brand: "rgb(45 212 191)",
  brandHover: "rgb(94 234 212)",
  brandFg: "rgb(4 47 46)",
  brandSoft: "rgb(19 45 48)",
  brandSoftFg: "rgb(153 246 228)",
  brandRgb: "45 212 191",
  bgRgb: "9 14 26",
  shadowCard: "0 1px 2px 0 rgb(0 0 0 / 0.25), 0 1px 3px 0 rgb(0 0 0 / 0.3)",
  shadowRaised: "0 4px 6px -2px rgb(0 0 0 / 0.3), 0 12px 20px -8px rgb(0 0 0 / 0.45)",
  badge: {
    neutral: { bg: "#1e293b", fg: "#e2e8f0" },
    ok: { bg: "rgb(6 78 59 / 0.6)", fg: "#a7f3d0" },
    warn: { bg: "rgb(120 53 15 / 0.6)", fg: "#fef3c7" },
    danger: { bg: "rgb(127 29 29 / 0.6)", fg: "#fecaca" },
    info: { bg: "rgb(12 74 110 / 0.6)", fg: "#bae6fd" },
    brand: { bg: "rgb(19 45 48)", fg: "rgb(153 246 228)" },
  },
  status: {
    running: { border: "rgb(12 74 110 / 0.7)", bg: "rgb(8 47 73 / 0.5)", accent: "#7dd3fc" },
    done: { border: "rgb(6 78 59 / 0.7)", bg: "rgb(2 44 34 / 0.5)", accent: "#6ee7b7" },
  },
  medal: {
    1: { border: "rgb(245 158 11 / 0.6)", bg: "#451a03", fg: "#fde68a", laurel: "rgb(245 158 11 / 0.8)" },
    2: { border: "rgb(100 116 139 / 0.6)", bg: "#1e293b", fg: "#f1f5f9", laurel: "rgb(148 163 184 / 0.7)" },
    3: { border: "rgb(234 88 12 / 0.6)", bg: "#431407", fg: "#fed7aa", laurel: "rgb(234 88 12 / 0.8)" },
  },
  positive: "#6ee7b7",
  negative: "#fca5a5",
  mapFilter:
    "invert(1) hue-rotate(180deg) brightness(0.92) contrast(0.9) saturate(0.9)",
  stage: {
    base: "#060a14",
    glowA: "rgb(45 212 191 / 0.22)",
    glowB: "rgb(56 189 248 / 0.16)",
    glowC: "rgb(129 140 248 / 0.14)",
    grid: "rgb(148 163 184 / 0.06)",
  },
  glass: "rgb(11 17 31 / 0.78)",
  glassBorder: "rgb(148 163 184 / 0.16)",
};

export const LIGHT: Theme = {
  name: "light",
  bg: "rgb(248 250 252)",
  surface: "rgb(255 255 255)",
  surfaceMuted: "rgb(241 245 249)",
  borderSubtle: "rgb(226 232 240)",
  borderStrong: "rgb(203 213 225)",
  fg: "rgb(15 23 42)",
  fgMuted: "rgb(100 116 139)",
  fgSubtle: "rgb(148 163 184)",
  brand: "rgb(13 148 136)",
  brandHover: "rgb(15 118 110)",
  brandFg: "rgb(255 255 255)",
  brandSoft: "rgb(240 253 250)",
  brandSoftFg: "rgb(17 94 89)",
  brandRgb: "13 148 136",
  bgRgb: "248 250 252",
  shadowCard: "0 1px 2px 0 rgb(15 23 42 / 0.04), 0 1px 3px 0 rgb(15 23 42 / 0.06)",
  shadowRaised: "0 4px 6px -2px rgb(15 23 42 / 0.06), 0 12px 20px -8px rgb(15 23 42 / 0.12)",
  badge: {
    neutral: { bg: "#f1f5f9", fg: "#334155" },
    ok: { bg: "#d1fae5", fg: "#065f46" },
    warn: { bg: "#fef3c7", fg: "#78350f" },
    danger: { bg: "#fee2e2", fg: "#991b1b" },
    info: { bg: "#e0f2fe", fg: "#075985" },
    brand: { bg: "rgb(240 253 250)", fg: "rgb(17 94 89)" },
  },
  status: {
    running: { border: "#bae6fd", bg: "#f0f9ff", accent: "#0369a1" },
    done: { border: "#a7f3d0", bg: "#ecfdf5", accent: "#047857" },
  },
  medal: {
    1: { border: "rgb(251 191 36 / 0.8)", bg: "#fffbeb", fg: "#92400e", laurel: "rgb(245 158 11 / 0.9)" },
    2: { border: "rgb(148 163 184 / 0.8)", bg: "#f1f5f9", fg: "#334155", laurel: "rgb(148 163 184 / 0.9)" },
    3: { border: "rgb(249 115 22 / 0.7)", bg: "#fff7ed", fg: "#9a3412", laurel: "rgb(249 115 22 / 0.8)" },
  },
  positive: "#047857",
  negative: "#b91c1c",
  mapFilter: "none",
  stage: {
    base: "#eef3f8",
    glowA: "rgb(45 212 191 / 0.28)",
    glowB: "rgb(56 189 248 / 0.2)",
    glowC: "rgb(129 140 248 / 0.16)",
    grid: "rgb(15 23 42 / 0.05)",
  },
  glass: "rgb(255 255 255 / 0.8)",
  glassBorder: "rgb(15 23 42 / 0.1)",
};

export function themeFor(name: ThemeName): Theme {
  return name === "light" ? LIGHT : DARK;
}

/** `MatchPill`: red at 0%, green at 100%, through orange and yellow. */
export function matchHue(percent: number): number {
  return Math.round(Math.min(100, Math.max(0, percent)) * 1.2);
}

export function matchPillColors(theme: Theme, percent: number): Tone {
  const h = matchHue(percent);
  return theme.name === "dark"
    ? { bg: `hsl(${h} 45% 16%)`, fg: `hsl(${h} 90% 75%)` }
    : { bg: `hsl(${h} 80% 88%)`, fg: `hsl(${h} 95% 22%)` };
}

/** `PlacePhoto`'s initials tile: a stable hue per name. */
export function placeHue(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % 360;
}

export function placeInitials(name: string): string {
  const letters = name
    .split(/[\s\-–—/&,.]+/)
    .map((word) => word.replace(/^[^\p{L}\p{N}]+/u, "").charAt(0))
    .filter((char) => char !== "");
  const picked = letters.slice(0, 2).join("");
  return (picked || name.trim().charAt(0) || "?").toUpperCase();
}

/** Map pin fills: the podium, then the brand colour. */
export const PIN_FILL: Record<number, string> = {
  1: "#d97706",
  2: "#64748b",
  3: "#ea580c",
};
