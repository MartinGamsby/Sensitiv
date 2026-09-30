import type { Scenario } from "../config/scenario.ts";
import type { TileId } from "./geo.ts";

// The contract between `scripts/assets.ts`, which downloads and caches every
// file a render needs, and the composition, which only ever draws what that
// script says is on disk. A render therefore never touches the network, and
// a photo that failed to download becomes the initials tile instead of a
// broken frame.

/** Relative to `apps/video/public/`. */
export const CACHE_DIR = "cache";
export const MANIFEST_FILE = `${CACHE_DIR}/manifest.json`;

/** The interface sounds `pnpm video:assets` synthesises (`scripts/lib/sfx.ts`). */
export const SOUND_NAMES = ["click", "key", "pop", "whoosh", "chime"] as const;
export type SoundName = (typeof SOUND_NAMES)[number];

export function soundFile(name: SoundName): string {
  return `${CACHE_DIR}/sfx/${name}.wav`;
}

export interface AssetManifest {
  version: 1;
  generatedAt: string;
  /** Inter, copied out of `@fontsource-variable/inter`. */
  fonts: { latin?: string; latinExt?: string };
  /** `z/x/y` keys of the OpenStreetMap tiles on disk. */
  tiles: string[];
  /**
   * Every image a scenario refers to → its path under `public/`, or `null`
   * when it could not be fetched (or a local file is missing).
   */
  images: Record<string, string | null>;
  /** The same for the music track. */
  audio: Record<string, string | null>;
  /** The synthesised interface sounds on disk. */
  sfx: Partial<Record<SoundName, string>>;
}

export const EMPTY_MANIFEST: AssetManifest = {
  version: 1,
  generatedAt: "",
  fonts: {},
  tiles: [],
  images: {},
  audio: {},
  sfx: {},
};

export function tileFile(tile: TileId): string {
  return `${CACHE_DIR}/tiles/${tile.z}/${tile.x}/${tile.y}.png`;
}

export function isRemote(ref: string): boolean {
  return /^https:\/\//i.test(ref);
}

/** Every image ref a scenario uses: the logo, the backdrop, each place's
 *  photo (after the scenario's overrides) and the music, if any. */
export function imageRefs(scenario: Scenario): string[] {
  const refs = new Set<string>();
  if (scenario.brand.logo) refs.add(scenario.brand.logo);
  if (scenario.images.hookBackdrop) refs.add(scenario.images.hookBackdrop);
  scenario.run.places.slice(0, scenario.visiblePlaces).forEach((place) => {
    const photo = photoRef(scenario, place.name, place.photo);
    if (photo) refs.add(photo);
  });
  return [...refs];
}

/** The photo a place ends up with: the scenario's override wins, `null`
 *  forces the initials tile. */
export function photoRef(
  scenario: Scenario,
  name: string,
  fromRun: string | undefined,
): string | undefined {
  if (Object.prototype.hasOwnProperty.call(scenario.images.photos, name)) {
    return scenario.images.photos[name] ?? undefined;
  }
  return fromRun;
}
