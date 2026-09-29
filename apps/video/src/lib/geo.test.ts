import { describe, expect, it } from "vitest";
import {
  interpolateView,
  metersPerPixel,
  project,
  radiusToPixels,
  tileLevels,
  tilesAt,
  tilesForView,
  toViewPixel,
  unproject,
  zoomToFitCircle,
  zoomToFitPoints,
} from "./geo.ts";

const PLACE_DES_ARTS = { lat: 45.508, lng: -73.5686 };

describe("web mercator", () => {
  it("round-trips a point through pixels", () => {
    const back = unproject(project(PLACE_DES_ARTS, 15.3), 15.3);
    expect(back.lat).toBeCloseTo(PLACE_DES_ARTS.lat, 9);
    expect(back.lng).toBeCloseTo(PLACE_DES_ARTS.lng, 9);
  });

  it("matches the textbook scale at the equator", () => {
    expect(metersPerPixel(0, 0)).toBeCloseTo(156543.03, 1);
    // Halves with every zoom level.
    expect(metersPerPixel(45.5, 16) * 2).toBeCloseTo(metersPerPixel(45.5, 15), 6);
  });

  it("puts the view's centre in the middle of the box", () => {
    const view = { center: PLACE_DES_ARTS, zoom: 14.2, width: 928, height: 288 };
    const p = toViewPixel(view, PLACE_DES_ARTS);
    expect(p.x).toBeCloseTo(464, 6);
    expect(p.y).toBeCloseTo(144, 6);
  });
});

describe("fitting a circle", () => {
  it("makes the circle exactly as tall as the box minus its padding", () => {
    const zoom = zoomToFitCircle(PLACE_DES_ARTS, 1, 928, 288, 16);
    const diameter = 2 * radiusToPixels(PLACE_DES_ARTS, 1, zoom);
    expect(diameter).toBeCloseTo(288 - 32, 3);
  });

  it("zooms out for a bigger radius", () => {
    expect(zoomToFitCircle(PLACE_DES_ARTS, 3, 928, 288)).toBeLessThan(
      zoomToFitCircle(PLACE_DES_ARTS, 1, 928, 288),
    );
  });

  it("frames a set of points with every one of them inside the box", () => {
    const points = [
      { lat: 45.5252585, lng: -73.5782105 },
      { lat: 45.4979, lng: -73.5732 },
      { lat: 45.5212, lng: -73.5967 },
      PLACE_DES_ARTS,
    ];
    const fit = zoomToFitPoints(points, 720, 608, 56);
    const view = { ...fit, width: 720, height: 608 };
    for (const point of points) {
      const p = toViewPixel(view, point);
      expect(p.x).toBeGreaterThanOrEqual(55);
      expect(p.x).toBeLessThanOrEqual(665);
      expect(p.y).toBeGreaterThanOrEqual(55);
      expect(p.y).toBeLessThanOrEqual(553);
    }
  });
});

describe("tiles", () => {
  it("blends into the next level as the zoom climbs toward it", () => {
    expect(tileLevels(14)).toEqual({ base: 14, next: 15, blend: 0 });
    const mid = tileLevels(14.25);
    expect(mid.base).toBe(14);
    expect(mid.blend).toBeCloseTo(0.25, 9);
  });

  it("covers the whole view, and no more than a tile's margin around it", () => {
    const view = { center: PLACE_DES_ARTS, zoom: 15, width: 928, height: 288 };
    const tiles = tilesAt(view, 15);
    const c = project(PLACE_DES_ARTS, 15);
    const xs = tiles.map((t) => t.x);
    const ys = tiles.map((t) => t.y);
    expect(Math.min(...xs) * 256).toBeLessThanOrEqual(c.x - 464);
    expect((Math.max(...xs) + 1) * 256).toBeGreaterThanOrEqual(c.x + 464);
    expect(Math.min(...ys) * 256).toBeLessThanOrEqual(c.y - 144);
    expect((Math.max(...ys) + 1) * 256).toBeGreaterThanOrEqual(c.y + 144);
    expect(tiles.length).toBeLessThanOrEqual(6 * 3);
  });

  it("asks for the next level only while cross-fading", () => {
    const at = (zoom: number) => tilesForView({ center: PLACE_DES_ARTS, zoom, width: 400, height: 300 });
    expect(new Set(at(15).map((t) => t.z))).toEqual(new Set([15]));
    expect(new Set(at(15.4).map((t) => t.z))).toEqual(new Set([15, 16]));
  });
});

describe("interpolateView", () => {
  it("starts and ends exactly on its two views", () => {
    const a = { center: { lat: 45.5233, lng: -73.5858 }, zoom: 13, width: 928, height: 288 };
    const b = { center: PLACE_DES_ARTS, zoom: 15.2, width: 928, height: 288 };
    expect(interpolateView(a, b, 0).center.lat).toBeCloseTo(a.center.lat, 9);
    expect(interpolateView(a, b, 1).center.lng).toBeCloseTo(b.center.lng, 9);
    expect(interpolateView(a, b, 0.5).zoom).toBeCloseTo(14.1, 9);
  });
});
