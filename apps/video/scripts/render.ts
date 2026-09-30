// pnpm video [scenario-id… | all] [--offline]
//
// Renders a scenario to `apps/video/out/<scenario-id>.mp4`: fetches whatever
// it needs first (map tiles, photos, fonts — cached after the first time),
// bundles the composition once, then encodes each scenario asked for. With no
// id, renders the default scenario.

import { statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { pickScenarios } from "./lib/pick.ts";
import { PUBLIC_DIR, prepareAssets } from "./lib/prepare.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2).filter((a) => a !== "--");
const selected = pickScenarios(args.filter((a) => !a.startsWith("--")));
await prepareAssets(selected, { offline: args.includes("--offline") });

process.stdout.write("\n  Bundling… ");
const serveUrl = await bundle({
  entryPoint: join(ROOT, "src", "index.ts"),
  publicDir: PUBLIC_DIR,
});
process.stdout.write("done\n");

for (const scenario of selected) {
  const inputProps = { scenarioId: scenario.id };
  const composition = await selectComposition({ serveUrl, id: scenario.id, inputProps });
  const output = join(ROOT, "out", `${scenario.id}.mp4`);
  const seconds = (composition.durationInFrames / composition.fps).toFixed(1);
  console.log(
    `\n  Rendering "${scenario.id}": ${composition.width}×${composition.height}, ` +
      `${composition.fps} fps, ${seconds} s (${composition.durationInFrames} frames)`,
  );
  const started = Date.now();
  let shown = -1;
  await renderMedia({
    serveUrl,
    composition,
    inputProps: composition.props,
    codec: "h264",
    // Keep in step with remotion.config.ts, which the Studio's render uses.
    crf: 16,
    pixelFormat: "yuv420p",
    imageFormat: "jpeg",
    jpegQuality: 94,
    outputLocation: output,
    overwrite: true,
    onProgress: ({ progress }) => {
      const pct = Math.floor(progress * 100);
      if (pct === shown || pct % 5 !== 0) return;
      shown = pct;
      process.stdout.write(`\r  ${String(pct).padStart(3)}%`);
    },
  });
  const mb = (statSync(output).size / 1024 / 1024).toFixed(1);
  const took = ((Date.now() - started) / 1000).toFixed(0);
  console.log(`\r  100% — ${relative(process.cwd(), output)} (${mb} MB, ${took} s)`);
}
console.log("");
