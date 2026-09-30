import { createContext, useContext, useMemo, type ReactNode } from "react";
import { staticFile } from "remotion";
import type { Scenario, Variant } from "./config/scenario.ts";
import { EMPTY_MANIFEST, type AssetManifest } from "./lib/assets.ts";
import { choreographyFor, type Choreography } from "./lib/choreography.ts";
import { copyVars } from "./lib/copy.ts";
import type { Timeline } from "./lib/timeline.ts";
import { themeFor, type Theme } from "./lib/theme.ts";
import { translator, type Translate } from "./lib/ui-copy.ts";

/** Everything a scene needs, computed once per composition. */
export interface VideoContextValue {
  scenario: Scenario;
  manifest: AssetManifest;
  theme: Theme;
  t: Translate;
  timeline: Timeline;
  chor: Choreography;
  /** The copy's {placeholders}, filled from the run. */
  vars: Record<string, string>;
  /** Tile keys on disk, for O(1) lookups while drawing maps. */
  tiles: ReadonlySet<string>;
  /**
   * An image ref → a URL the renderer can load, or `undefined`. Only files the
   * asset step put on disk are ever drawn: a missing one would fail the whole
   * render over a single picture, so it falls back instead.
   */
  image: (ref: string | undefined) => string | undefined;
  /** The requirement chips, in the form's order. */
  chipIds: string[];
  /** The ticked requirement's intents, in catalog order. */
  intentIds: string[];
  intentLabels: string[];
  width: number;
  height: number;
}

const VideoContext = createContext<VideoContextValue | null>(null);

export function useVideo(): VideoContextValue {
  const value = useContext(VideoContext);
  if (!value) throw new Error("useVideo() outside <VideoProvider>");
  return value;
}

export function VideoProvider({
  scenario,
  manifest,
  variant = "video",
  children,
}: {
  scenario: Scenario;
  manifest?: AssetManifest;
  variant?: Variant;
  children: ReactNode;
}) {
  const value = useMemo<VideoContextValue>(() => {
    const m = manifest ?? EMPTY_MANIFEST;
    const planned = choreographyFor(scenario, variant);
    return {
      scenario,
      manifest: m,
      theme: themeFor(scenario.theme),
      t: translator(scenario.locale),
      timeline: planned.timeline,
      chor: planned.chor,
      vars: copyVars(scenario),
      tiles: new Set(m.tiles),
      image: (ref) => {
        if (!ref) return undefined;
        const cached = m.images[ref];
        return cached ? staticFile(cached) : undefined;
      },
      chipIds: planned.chipIds,
      intentIds: planned.intentIds,
      intentLabels: planned.intentLabels,
      width: scenario.video.width,
      height: scenario.video.height,
    };
  }, [scenario, manifest, variant]);

  return <VideoContext.Provider value={value}>{children}</VideoContext.Provider>;
}
