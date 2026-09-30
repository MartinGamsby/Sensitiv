// pnpm video:gif [scenario-id… | all] [--offline]
//
// Renders the README GIF: `docs/<scenario-id>.gif` at the repo root. Not a
// conversion of the MP4 — a GIF of that comes to 25–60 MB, because the MP4's
// film grain, drifting light and slow camera push-ins change every pixel of
// every frame, and an unchanged pixel is the only thing a GIF stores cheaply.
// So the same composition is rendered again as its `gif` variant (still
// background, a camera that holds still between moves, no sound) at the GIF's
// own size and frame rate (`scenario.gif`), then encoded with a palette
// computed from the frames themselves.
//
// Uses the ffmpeg that ships with Remotion, so nothing needs installing.

import { execFile } from "node:child_process";
import { mkdirSync, rmSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { bundle } from "@remotion/bundler";
import { RenderInternals, renderMedia, selectComposition } from "@remotion/renderer";
import { gifSize } from "./lib/gif-size.ts";
import { pickScenarios } from "./lib/pick.ts";
import { PUBLIC_DIR, prepareAssets } from "./lib/prepare.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = resolve(ROOT, "..", "..");
const args = process.argv.slice(2).filter((a) => a !== "--");
const selected = pickScenarios(args.filter((a) => !a.startsWith("--")));
await prepareAssets(selected, { offline: args.includes("--offline") });

// Internal, but the renderer is pinned to one version; this is the binary
// `npx remotion ffmpeg` runs, without that CLI's start-up checks.
const ffmpeg = RenderInternals.getExecutablePath({
  type: "ffmpeg",
  indent: false,
  logLevel: "error",
  binariesDirectory: null,
});

process.stdout.write("\n  Bundling… ");
const serveUrl = await bundle({ entryPoint: join(ROOT, "src", "index.ts"), publicDir: PUBLIC_DIR });
process.stdout.write("done\n");

for (const scenario of selected) {
  const inputProps = { scenarioId: scenario.id, variant: "gif" as const };
  const composition = await selectComposition({ serveUrl, id: scenario.id, inputProps });
  const size = gifSize(scenario.gif.width, composition.width, composition.height);
  const frames = join(ROOT, "out", `${scenario.id}.gif-frames.mp4`);
  const output = join(REPO, "docs", `${scenario.id}.gif`);
  const seconds = (composition.durationInFrames / composition.fps).toFixed(1);
  console.log(
    `\n  GIF "${scenario.id}": ${size.width}×${size.height}, ${composition.fps} fps, ${seconds} s`,
  );

  let shown = -1;
  await renderMedia({
    serveUrl,
    composition,
    inputProps: composition.props,
    scale: size.scale,
    // A near-lossless, full-colour intermediate: 4:2:0 would smear the teal
    // text on dark that the palette then has to reproduce.
    codec: "h264",
    crf: 8,
    pixelFormat: "yuv444p",
    imageFormat: "jpeg",
    jpegQuality: 96,
    muted: true,
    outputLocation: frames,
    overwrite: true,
    onProgress: ({ progress }) => {
      const pct = Math.floor(progress * 100);
      if (pct === shown || pct % 5 !== 0) return;
      shown = pct;
      process.stdout.write(`\r  rendering ${String(pct).padStart(3)}%`);
    },
  });

  process.stdout.write("\r  encoding GIF…    ");
  mkdirSync(dirname(output), { recursive: true });
  // One palette for the whole GIF, weighted toward what changes between
  // frames; ordered dithering, which compresses far better than error
  // diffusion; and only the changed rectangle written for each frame.
  await promisify(execFile)(ffmpeg, [
    "-v",
    "error",
    "-y",
    "-i",
    frames,
    "-filter_complex",
    `split[a][b];[a]palettegen=stats_mode=diff:max_colors=${scenario.gif.colors}[p];` +
      "[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle",
    "-loop",
    "0",
    output,
  ]);
  rmSync(frames, { force: true });
  const mb = (statSync(output).size / 1024 / 1024).toFixed(1);
  console.log(`\r  ${relative(process.cwd(), output)} (${mb} MB)`);
}
console.log("");
