// Web Mercator, as slippy-map tiles use it. Pure numbers, no React, so the
// asset script can work out which tiles a render will need using exactly the
// maths the map component draws with.

export const TILE_SIZE = 256;

/** Tile levels the video ever draws; outside this, nothing is fetched. */
export const MIN_TILE_ZOOM = 3;
export const MAX_TILE_ZOOM = 18;

export interface LatLng {
  lat: number;
  lng: number;
}

export interface Pixel {
  x: number;
  y: number;
}

/** A map viewport: what is centred where, at which (fractional) zoom, in a
 *  box of this many CSS pixels. */
export interface MapView {
  center: LatLng;
  zoom: number;
  width: number;
  height: number;
}

export interface TileId {
  z: number;
  x: number;
  y: number;
}

/** Mercator stops making sense near the poles; so does a restaurant search. */
const MAX_LAT = 85.05112878;

export function worldSize(zoom: number): number {
  return TILE_SIZE * 2 ** zoom;
}

/** Latitude/longitude to global pixel coordinates at `zoom`. */
export function project(point: LatLng, zoom: number): Pixel {
  const size = worldSize(zoom);
  const lat = Math.max(-MAX_LAT, Math.min(MAX_LAT, point.lat));
  const sin = Math.sin((lat * Math.PI) / 180);
  return {
    x: ((point.lng + 180) / 360) * size,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size,
  };
}

export function unproject(pixel: Pixel, zoom: number): LatLng {
  const size = worldSize(zoom);
  const n = Math.PI - (2 * Math.PI * pixel.y) / size;
  return {
    lat: (180 / Math.PI) * Math.atan(Math.sinh(n)),
    lng: (pixel.x / size) * 360 - 180,
  };
}

/** Ground metres covered by one CSS pixel at this latitude and zoom. */
export function metersPerPixel(lat: number, zoom: number): number {
  return (
    (2 * Math.PI * 6378137 * Math.cos((lat * Math.PI) / 180)) / worldSize(zoom)
  );
}

/** Where `point` lands inside `view`, in the view's own CSS pixels. */
export function toViewPixel(view: MapView, point: LatLng): Pixel {
  const c = project(view.center, view.zoom);
  const p = project(point, view.zoom);
  return { x: view.width / 2 + (p.x - c.x), y: view.height / 2 + (p.y - c.y) };
}

/** A circle's radius in the view's CSS pixels. */
export function radiusToPixels(center: LatLng, radiusKm: number, zoom: number): number {
  return (radiusKm * 1000) / metersPerPixel(center.lat, zoom);
}

/**
 * The zoom at which a circle fits the box with `padding` to spare on every
 * side — Leaflet's `fitBounds(circle.getBounds())`, which is what the app does
 * whenever the radius changes.
 */
export function zoomToFitCircle(
  center: LatLng,
  radiusKm: number,
  width: number,
  height: number,
  padding = 16,
): number {
  const needPx = Math.max(1, Math.min(width, height) - 2 * padding);
  const metres = radiusKm * 2000;
  const mppAtZ0 = metersPerPixel(center.lat, 0);
  return Math.log2((mppAtZ0 * needPx) / metres);
}

/** The zoom at which every point fits the box, around their bounding box. */
export function zoomToFitPoints(
  points: readonly LatLng[],
  width: number,
  height: number,
  padding = 48,
): { center: LatLng; zoom: number } {
  if (points.length === 0) throw new Error("zoomToFitPoints needs at least one point");
  const z = 20;
  const px = points.map((p) => project(p, z));
  const minX = Math.min(...px.map((p) => p.x));
  const maxX = Math.max(...px.map((p) => p.x));
  const minY = Math.min(...px.map((p) => p.y));
  const maxY = Math.max(...px.map((p) => p.y));
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  const scale = Math.min(
    (width - 2 * padding) / spanX,
    (height - 2 * padding) / spanY,
  );
  return {
    center: unproject({ x: (minX + maxX) / 2, y: (minY + maxY) / 2 }, z),
    zoom: Math.min(17, z + Math.log2(scale)),
  };
}

/** The whole-number tile level drawn for a fractional zoom, and how far into
 *  the next one it is — the map cross-fades by that fraction. */
export function tileLevels(zoom: number): { base: number; next: number; blend: number } {
  const clamped = Math.max(MIN_TILE_ZOOM, Math.min(MAX_TILE_ZOOM, zoom));
  const base = Math.min(MAX_TILE_ZOOM, Math.floor(clamped));
  const blend = clamped - base;
  return { base, next: Math.min(MAX_TILE_ZOOM, base + 1), blend };
}

/**
 * Every tile at level `z` that intersects `view`. Wraps nothing and clamps at
 * the world's edges, which a city-scale view never reaches.
 */
export function tilesAt(view: MapView, z: number): TileId[] {
  const scale = 2 ** (view.zoom - z);
  const c = project(view.center, z);
  const halfW = view.width / 2 / scale;
  const halfH = view.height / 2 / scale;
  const max = 2 ** z - 1;
  const x0 = Math.max(0, Math.floor((c.x - halfW) / TILE_SIZE));
  const x1 = Math.min(max, Math.floor((c.x + halfW) / TILE_SIZE));
  const y0 = Math.max(0, Math.floor((c.y - halfH) / TILE_SIZE));
  const y1 = Math.min(max, Math.floor((c.y + halfH) / TILE_SIZE));
  const tiles: TileId[] = [];
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) tiles.push({ z, x, y });
  }
  return tiles;
}

/** The tiles a view actually draws: its base level, plus the next one while
 *  it is cross-fading into it. */
export function tilesForView(view: MapView): TileId[] {
  const { base, next, blend } = tileLevels(view.zoom);
  const tiles = tilesAt(view, base);
  if (blend > 0.001 && next !== base) tiles.push(...tilesAt(view, next));
  return tiles;
}

export function tileKey(tile: TileId): string {
  return `${tile.z}/${tile.x}/${tile.y}`;
}

/** Straight-line interpolation between two views in projected space, with the
 *  zoom eased separately — the "fly to" the map does between two places. */
export function interpolateView(from: MapView, to: MapView, t: number): MapView {
  const zoom = from.zoom + (to.zoom - from.zoom) * t;
  // Interpolate the centre at a fixed reference zoom so the path is straight
  // on the map rather than bowed by the changing scale.
  const ref = 20;
  const a = project(from.center, ref);
  const b = project(to.center, ref);
  const center = unproject({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, ref);
  return {
    center,
    zoom,
    width: from.width + (to.width - from.width) * t,
    height: from.height + (to.height - from.height) * t,
  };
}
