import { CACHE_DIR } from "./lib/assets.ts";

/**
 * The Inter files a render loads, where `pnpm video:assets` copies them to, and
 * the unicode ranges `@fontsource-variable/inter` gives them. Kept apart from
 * `fonts.ts` so the asset script can read it without loading Remotion.
 */
export const FONT_FILES = [
  {
    file: `${CACHE_DIR}/fonts/inter-latin-opsz-normal.woff2`,
    range:
      "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD",
  },
  {
    file: `${CACHE_DIR}/fonts/inter-latin-ext-opsz-normal.woff2`,
    range:
      "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF",
  },
] as const;
