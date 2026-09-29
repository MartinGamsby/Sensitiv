import type { ReactNode } from "react";
import { Img, staticFile } from "remotion";
import { useVideo } from "../context.tsx";
import { tileFile } from "../lib/assets.ts";
import {
  TILE_SIZE,
  project,
  tileKey,
  tileLevels,
  tilesAt,
  type MapView,
} from "../lib/geo.ts";

/**
 * A slippy map drawn from cached OpenStreetMap tiles, at any fractional zoom:
 * the whole-number level underneath, and the next one cross-fading in on top
 * of it as the zoom approaches it — so a fly-in never pops.
 *
 * Only tiles `pnpm video:assets` put on disk are drawn; anything else shows
 * the map's plain background. Overlays go in `children`, positioned with
 * `toViewPixel(view, point)`.
 */
export function TileMap({
  view,
  children,
  attribution = true,
  controls = false,
}: {
  view: MapView;
  children?: ReactNode;
  attribution?: boolean;
  /** Leaflet's +/− control, as the app's maps show it. */
  controls?: boolean;
}) {
  const { theme, tiles } = useVideo();
  const { base, next, blend } = tileLevels(view.zoom);
  // Smoothstep, so the next level fades in without a visible start or stop.
  const fade = blend * blend * (3 - 2 * blend);

  const layer = (z: number, opacity: number) => {
    const scale = 2 ** (view.zoom - z);
    const c = project(view.center, z);
    const size = TILE_SIZE * scale;
    return tilesAt(view, z)
      .filter((tile) => tiles.has(tileKey(tile)))
      .map((tile) => (
        <Img
          key={`${z}-${tile.x}-${tile.y}`}
          src={staticFile(tileFile(tile))}
          style={{
            position: "absolute",
            left: view.width / 2 + (tile.x * TILE_SIZE - c.x) * scale,
            top: view.height / 2 + (tile.y * TILE_SIZE - c.y) * scale,
            // Half a pixel of overlap hides the seams scaling leaves.
            width: size + 0.5,
            height: size + 0.5,
            opacity,
          }}
        />
      ));
  };

  return (
    <div
      style={{
        position: "relative",
        width: view.width,
        height: view.height,
        overflow: "hidden",
        background: theme.surfaceMuted,
      }}
    >
      <div style={{ position: "absolute", inset: 0, filter: theme.mapFilter }}>
        {layer(base, 1)}
        {fade > 0.001 && next !== base ? layer(next, fade) : null}
      </div>
      <div style={{ position: "absolute", inset: 0 }}>{children}</div>
      {controls ? <ZoomControl /> : null}
      {attribution ? <Attribution /> : null}
    </div>
  );
}

function ZoomControl() {
  const { theme } = useVideo();
  const button = (label: string, last: boolean) => (
    <div
      style={{
        width: 30,
        height: 30,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 18,
        fontWeight: 700,
        color: theme.fg,
        background: theme.surface,
        borderBottom: last ? "none" : `1px solid ${theme.borderSubtle}`,
      }}
    >
      {label}
    </div>
  );
  return (
    <div
      style={{
        position: "absolute",
        left: 10,
        top: 10,
        borderRadius: 4,
        overflow: "hidden",
        border: "2px solid rgb(0 0 0 / 0.2)",
      }}
    >
      {button("+", false)}
      {button("−", true)}
    </div>
  );
}

function Attribution() {
  const { theme } = useVideo();
  return (
    <div
      style={{
        position: "absolute",
        right: 0,
        bottom: 0,
        padding: "1px 6px",
        fontSize: 11,
        lineHeight: "16px",
        background: theme.name === "dark" ? "rgb(17 24 39 / 0.85)" : "rgb(255 255 255 / 0.85)",
        color: theme.fgSubtle,
      }}
    >
      <span style={{ color: theme.brand }}>Leaflet</span> | ©{" "}
      <span style={{ color: theme.brand }}>OpenStreetMap</span> contributors
    </div>
  );
}
