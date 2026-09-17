import { z } from "zod";

// Geography is anywhere. The `query` string always carries the human-readable
// place ("Plateau-Mont-Royal, Montreal"); the structured fields are optional
// hints. Postal/ZIP formats vary wildly worldwide — length-bounded and
// whitespace-stripped, nothing stricter (a valid Canadian FSA like "H2T" must
// pass). `lat`/`lng`/`radiusKm` are v1.1 map-pin territory; the fields exist now.
export const LocationSchema = z.object({
  query: z
    .string()
    .trim()
    .min(1, "location query must not be empty"),
  city: z.string().trim().min(1).optional(),
  region: z.string().trim().min(1).optional(),
  country: z
    .string()
    .trim()
    .length(2, "country must be an ISO 3166-1 alpha-2 code")
    .transform((c) => c.toUpperCase())
    .optional(),
  countryName: z.string().trim().min(1).optional(),
  postalCode: z
    .string()
    .transform((s) => s.replace(/\s+/g, ""))
    .pipe(
      z
        .string()
        .min(2, "postal code too short")
        .max(12, "postal code too long"),
    )
    .optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  radiusKm: z.number().positive().max(500).default(5),
});

export type Location = z.infer<typeof LocationSchema>;
export type LocationInput = z.input<typeof LocationSchema>;

/**
 * Pick the proxy country code to hand to Solari. Returns the location's own
 * country (lowercased — Solari expects lowercase) when it is a 2-char code,
 * otherwise the fallback (from `SOLARI_PROXY_COUNTRY`, default "ca"). Whether to
 * send a proxy at all is Section 7's call; this helper only picks a value.
 */
export function proxyCountryFrom(
  location: Pick<Location, "country">,
  fallback = "ca",
): string {
  const country = location.country?.trim();
  if (country && country.length === 2) return country.toLowerCase();
  return fallback;
}

/**
 * Google-Maps zoom level for a search radius, for the `/@lat,lng,<z>z` segment
 * of a Maps URL.
 *
 * This is the single most load-bearing number in the location pipeline. A Maps
 * search URL with no `@` segment lets GOOGLE pick the viewport from the query
 * text, and it picks badly: "…restaurant Quebec, Canada H1S" resolved to
 * `@46.18,-72.42,9z` — a province-wide view centred in farmland — and returned
 * Quebec City results for a Montreal postal code 250 km away. An explicit `@`
 * segment overrides that completely, even when the query text still names
 * another city.
 *
 * Steps rather than a log formula: Maps snaps to integer zooms anyway, and a
 * table is something a human can check against a map.
 */
export function zoomForRadiusKm(radiusKm: number): number {
  const r = Number.isFinite(radiusKm) && radiusKm > 0 ? radiusKm : 5;
  if (r <= 1) return 15;
  if (r <= 2) return 14;
  if (r <= 5) return 13;
  if (r <= 10) return 12;
  if (r <= 25) return 11;
  if (r <= 50) return 10;
  if (r <= 100) return 9;
  return 8;
}

/** A resolved map viewport: where a search is actually centred, and how tight. */
export interface Viewport {
  lat: number;
  lng: number;
  zoom: number;
}

/** The viewport carried by a `Location`, or `undefined` when it has no
 *  coordinates. `radiusKm` has a schema default, so zoom is always derivable
 *  once lat/lng exist. */
export function viewportFor(location: Location): Viewport | undefined {
  if (typeof location.lat !== "number" || typeof location.lng !== "number") {
    return undefined;
  }
  return {
    lat: location.lat,
    lng: location.lng,
    zoom: zoomForRadiusKm(location.radiusKm),
  };
}

/** Mean Earth radius, km. */
const EARTH_RADIUS_KM = 6371;

/**
 * Great-circle distance in km. Haversine — a few metres of error over a city,
 * which is irrelevant next to the precision of the coordinates themselves.
 */
export function distanceKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const toRad = (deg: number): number => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}
