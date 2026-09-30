// Puts every file a render needs into `apps/video/public/cache/` (git-ignored)
// and writes the manifest the composition draws from:
//
//   - the OpenStreetMap tiles each map move will show — worked out by replaying
//     the scenario's own choreography, frame by frame, so nothing is guessed;
//   - every remote photo / backdrop / music file a scenario refers to;
//   - the Inter font files, from the `@fontsource-variable/inter` package.
//
// Everything is cached: a second run downloads nothing. `offline` never
// touches the network and records only what is already on disk.
//
// Tiles come from tile.openstreetmap.org, whose usage policy asks for an
// identifying User-Agent, modest concurrency and local caching. A scenario
// needs about a hundred tiles, fetched once; the video credits OpenStreetMap
// on every frame that shows a map.

import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isSafePhotoUrl } from "@sensitiv/shared/safe-url";
import { scenarioFor, type Scenario } from "../../src/config/scenario.ts";
import {
  CACHE_DIR,
  MANIFEST_FILE,
  SOUND_NAMES,
  imageRefs,
  isRemote,
  soundFile,
  tileFile,
  type AssetManifest,
} from "../../src/lib/assets.ts";
import { choreographyFor, sampleMapViews } from "../../src/lib/choreography.ts";
import { tileKey, tilesForView, type TileId } from "../../src/lib/geo.ts";
import { FONT_FILES } from "../../src/fonts-files.ts";
import { AUDIO_TYPES, DownloadError, IMAGE_TYPES, download, eachLimit } from "./download.ts";
import { SOUNDS, wavBytes } from "./sfx.ts";

export const PUBLIC_DIR = fileURLToPath(new URL("../../public/", import.meta.url));
const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const USER_AGENT =
  "sensitiv-demo-video/0.1 (renders a local product demo; tiles cached on disk)";

function publicPath(relative: string): string {
  return join(PUBLIC_DIR, ...relative.split("/"));
}

function ensureDir(file: string): void {
  mkdirSync(dirname(file), { recursive: true });
}

/** A URL shortened for a log line — never logged whole. */
function short(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.pathname.slice(0, 32)}…`;
  } catch {
    return url.slice(0, 48);
  }
}

function copyFonts(): AssetManifest["fonts"] {
  const require = createRequire(import.meta.url);
  const pkg = dirname(require.resolve("@fontsource-variable/inter/package.json"));
  const out: AssetManifest["fonts"] = {};
  for (const [i, font] of FONT_FILES.entries()) {
    const name = font.file.split("/").pop()!;
    const from = join(pkg, "files", name);
    const to = publicPath(font.file);
    if (!existsSync(from)) {
      console.warn(`  ! font file missing from @fontsource-variable/inter: ${name}`);
      continue;
    }
    ensureDir(to);
    if (!existsSync(to)) copyFileSync(from, to);
    if (i === 0) out.latin = font.file;
    else out.latinExt = font.file;
  }
  return out;
}

/** Synthesised on every run: a few kilobytes, and always in step with sfx.ts. */
function writeSounds(): AssetManifest["sfx"] {
  const out: AssetManifest["sfx"] = {};
  for (const name of SOUND_NAMES) {
    const file = soundFile(name);
    const to = publicPath(file);
    ensureDir(to);
    writeFileSync(to, wavBytes(SOUNDS[name]()));
    out[name] = file;
  }
  return out;
}

async function fetchTiles(scenarios: readonly Scenario[], offline: boolean): Promise<string[]> {
  const needed = new Map<string, TileId>();
  for (const scenario of scenarios) {
    // Both renders: the MP4, and the GIF, which moves its maps differently.
    for (const variant of ["video", "gif"] as const) {
      const { chor } = choreographyFor(scenarioFor(scenario, variant), variant);
      for (const view of sampleMapViews(chor)) {
        for (const tile of tilesForView(view)) needed.set(tileKey(tile), tile);
      }
    }
  }

  const missing = [...needed.values()].filter((t) => !existsSync(publicPath(tileFile(t))));
  let fetched = 0;
  let failed = 0;
  if (missing.length > 0 && !offline) {
    process.stdout.write(`  map tiles: fetching ${missing.length} from OpenStreetMap `);
    await eachLimit(missing, 2, async (tile) => {
      const url = TILE_URL.replace("{z}", String(tile.z))
        .replace("{x}", String(tile.x))
        .replace("{y}", String(tile.y));
      try {
        const { bytes } = await download(url, {
          types: { "image/png": "png" },
          maxBytes: 1024 * 1024,
          timeoutMs: 15_000,
          headers: { "user-agent": USER_AGENT, accept: "image/png" },
        });
        const to = publicPath(tileFile(tile));
        ensureDir(to);
        writeFileSync(to, bytes);
        fetched++;
        if (fetched % 10 === 0) process.stdout.write(".");
      } catch (err) {
        failed++;
        if (failed <= 3) console.warn(`\n  ! tile ${tileKey(tile)}: ${(err as Error).message}`);
      }
    });
    process.stdout.write("\n");
  }
  const onDisk = [...needed.values()].filter((t) => existsSync(publicPath(tileFile(t))));
  console.log(
    `  map tiles: ${onDisk.length}/${needed.size} ready` +
      (fetched ? `, ${fetched} downloaded` : "") +
      (failed ? `, ${failed} failed (drawn as blank map)` : "") +
      (offline && missing.length ? ` (offline: ${missing.length} not fetched)` : ""),
  );
  return onDisk.map(tileKey).sort();
}

async function cacheMedia(
  refs: readonly string[],
  kind: "image" | "audio",
  offline: boolean,
): Promise<Record<string, string | null>> {
  const out: Record<string, string | null> = {};
  let ok = 0;
  for (const ref of refs) {
    if (!isRemote(ref)) {
      // A file the scenario keeps under public/, used as is — if it is there.
      if (existsSync(publicPath(ref))) {
        out[ref] = ref;
        ok++;
      } else {
        out[ref] = null;
        console.warn(`  ! ${kind} not found: apps/video/public/${ref}`);
      }
      continue;
    }
    if (!isSafePhotoUrl(ref)) {
      out[ref] = null;
      console.warn(`  ! ${kind} URL refused (https to a public host only): ${short(ref)}`);
      continue;
    }
    const stem = `${CACHE_DIR}/${kind === "image" ? "img" : "audio"}/${createHash("sha256")
      .update(ref)
      .digest("hex")
      .slice(0, 20)}`;
    const types = kind === "image" ? IMAGE_TYPES : AUDIO_TYPES;
    const cached = [...new Set(Object.values(types))]
      .map((ext) => `${stem}.${ext}`)
      .find((file) => existsSync(publicPath(file)));
    if (cached) {
      out[ref] = cached;
      ok++;
      continue;
    }
    if (offline) {
      out[ref] = null;
      continue;
    }
    try {
      const { bytes, ext } = await download(ref, {
        types,
        maxBytes: kind === "image" ? 5 * 1024 * 1024 : 30 * 1024 * 1024,
        timeoutMs: kind === "image" ? 8_000 : 30_000,
        headers: { accept: kind === "image" ? "image/*" : "audio/*" },
      });
      const file = `${stem}.${ext}`;
      const to = publicPath(file);
      ensureDir(to);
      writeFileSync(to, bytes);
      out[ref] = file;
      ok++;
    } catch (err) {
      out[ref] = null;
      const why = err instanceof DownloadError ? err.message : String(err);
      console.warn(`  ! ${kind} ${short(ref)}: ${why} — falling back`);
    }
  }
  if (refs.length > 0) {
    console.log(`  ${kind === "image" ? "images" : "audio"}: ${ok}/${refs.length} ready`);
  }
  return out;
}

export async function prepareAssets(
  scenarios: readonly Scenario[],
  options: { offline?: boolean } = {},
): Promise<AssetManifest> {
  const offline = options.offline ?? false;
  console.log(`\n  Preparing assets for: ${scenarios.map((s) => s.id).join(", ")}`);
  const fonts = copyFonts();
  console.log(`  fonts: ${Object.keys(fonts).length}/${FONT_FILES.length} ready`);
  const tiles = await fetchTiles(scenarios, offline);
  const images = await cacheMedia([...new Set(scenarios.flatMap(imageRefs))], "image", offline);
  const audio = await cacheMedia(
    [...new Set(scenarios.flatMap((s) => (s.audio.music ? [s.audio.music] : [])))],
    "audio",
    offline,
  );

  const sfx = writeSounds();
  console.log(`  sounds: ${Object.keys(sfx).length} synthesised`);

  const manifest: AssetManifest = {
    version: 1,
    generatedAt: new Date().toISOString(),
    fonts,
    tiles,
    images,
    audio,
    sfx,
  };
  const manifestPath = publicPath(MANIFEST_FILE);
  ensureDir(manifestPath);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}
