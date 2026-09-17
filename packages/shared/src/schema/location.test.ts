import { describe, expect, it } from "vitest";
import {
  LocationSchema,
  proxyCountryFrom,
  viewportFor,
  zoomForRadiusKm,
} from "./location.ts";

describe("LocationSchema", () => {
  it("accepts a minimal { query } and defaults radiusKm to 5", () => {
    const parsed = LocationSchema.parse({ query: "Plateau-Mont-Royal, Montreal" });
    expect(parsed.query).toBe("Plateau-Mont-Royal, Montreal");
    expect(parsed.radiusKm).toBe(5);
  });

  it("trims the query and rejects an empty / whitespace query", () => {
    expect(LocationSchema.parse({ query: "  Berlin  " }).query).toBe("Berlin");
    expect(() => LocationSchema.parse({ query: "" })).toThrow();
    expect(() => LocationSchema.parse({ query: "   " })).toThrow();
  });

  it("normalizes country to uppercase ISO alpha-2", () => {
    expect(LocationSchema.parse({ query: "x", country: "ca" }).country).toBe("CA");
    expect(() => LocationSchema.parse({ query: "x", country: "canada" })).toThrow();
  });

  it("accepts postal codes from anywhere and strips whitespace", () => {
    expect(LocationSchema.parse({ query: "x", postalCode: "H2T" }).postalCode).toBe("H2T");
    expect(LocationSchema.parse({ query: "x", postalCode: "SW1A 1AA" }).postalCode).toBe("SW1A1AA");
    expect(LocationSchema.parse({ query: "x", postalCode: "75001" }).postalCode).toBe("75001");
    expect(() => LocationSchema.parse({ query: "x", postalCode: "1" })).toThrow();
  });

  it("bounds lat/lng", () => {
    expect(() => LocationSchema.parse({ query: "x", lat: 91 })).toThrow();
    expect(() => LocationSchema.parse({ query: "x", lng: -200 })).toThrow();
    expect(LocationSchema.parse({ query: "x", lat: 45.5, lng: -73.6 }).lat).toBe(45.5);
  });
});

describe("proxyCountryFrom", () => {
  it("lowercases a present 2-char country", () => {
    expect(proxyCountryFrom({ country: "CA" })).toBe("ca");
  });

  it("falls back when country is absent", () => {
    expect(proxyCountryFrom({}, "fr")).toBe("fr");
    expect(proxyCountryFrom({})).toBe("ca");
  });
});

describe("zoomForRadiusKm", () => {
  it("tightens the viewport as the radius shrinks", () => {
    expect(zoomForRadiusKm(1)).toBeGreaterThan(zoomForRadiusKm(5));
    expect(zoomForRadiusKm(5)).toBeGreaterThan(zoomForRadiusKm(25));
    expect(zoomForRadiusKm(25)).toBeGreaterThan(zoomForRadiusKm(100));
  });

  it("gives a neighbourhood-scale zoom for the 5 km default", () => {
    expect(zoomForRadiusKm(5)).toBe(13);
  });

  it("falls back to the 5 km zoom for a nonsense radius", () => {
    expect(zoomForRadiusKm(0)).toBe(13);
    expect(zoomForRadiusKm(-3)).toBe(13);
    expect(zoomForRadiusKm(Number.NaN)).toBe(13);
  });

  it("never returns a world view, however large the radius", () => {
    expect(zoomForRadiusKm(10_000)).toBeGreaterThanOrEqual(8);
  });
});

describe("viewportFor", () => {
  it("is undefined without coordinates — the case that broke job 8150b7c4", () => {
    expect(viewportFor(LocationSchema.parse({ query: "Quebec, Canada" }))).toBeUndefined();
  });

  it("pairs the coordinates with a radius-derived zoom", () => {
    const viewport = viewportFor(
      LocationSchema.parse({
        query: "Saint-Leonard, Montreal",
        lat: 45.582,
        lng: -73.5829,
        radiusKm: 2,
      }),
    );
    expect(viewport).toEqual({ lat: 45.582, lng: -73.5829, zoom: 14 });
  });

  it("needs BOTH coordinates, not just one", () => {
    expect(
      viewportFor(LocationSchema.parse({ query: "x", lat: 45.5 })),
    ).toBeUndefined();
  });
});
