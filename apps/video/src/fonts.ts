import { continueRender, delayRender, staticFile } from "remotion";
import { FONT_FILES } from "./fonts-files.ts";

// Inter, copied into `public/cache/fonts/` by `pnpm video:assets` from the
// `@fontsource-variable/inter` package (SIL Open Font License). Loaded once
// per render tab, before the first frame is captured; if the files are not
// there the video falls back to the system font rather than failing.

export const FONT_FAMILY = "Inter Video";
export const FONT_STACK = `"${FONT_FAMILY}", "Inter", ui-sans-serif, system-ui, "Segoe UI", sans-serif`;
export const MONO_STACK =
  'ui-monospace, "Cascadia Mono", "SF Mono", "SFMono-Regular", Menlo, Consolas, monospace';

let started = false;

export function loadFonts(): void {
  if (started || typeof document === "undefined") return;
  started = true;
  const handle = delayRender("Loading Inter");
  Promise.all(
    FONT_FILES.map(async ({ file, range }) => {
      const face = new FontFace(FONT_FAMILY, `url('${staticFile(file)}') format('woff2')`, {
        weight: "100 900",
        unicodeRange: range,
        display: "block",
      });
      await face.load();
      document.fonts.add(face);
    }),
  )
    .catch((err: unknown) => {
      console.warn(
        `Inter did not load (${String(err)}); run \`pnpm video:assets\`. Using the system font.`,
      );
    })
    .finally(() => continueRender(handle));
}
