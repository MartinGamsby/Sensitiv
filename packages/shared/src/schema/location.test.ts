import { describe, expect, it } from "vitest";
import { LocationSchema, proxyCountryFrom } from "./location.ts";

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
