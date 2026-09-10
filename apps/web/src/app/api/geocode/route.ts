// GET /api/geocode?lat=&lng=[&locale=]  — server-side reverse geocode proxy.
//
// This is the app's SSRF surface: a server-side fetch driven by client input.
// Every one of these is load-bearing:
//   * the upstream origin is a HARDCODED constant — never assembled from user
//     input, a query param, or a header;
//   * only `lat` and `lng` are read, both Zod-coerced, finite, and range-checked;
//   * the fetch has a 5 s timeout;
//   * only the mapped `Location` fields are returned, never the raw upstream body;
//   * coordinates are personal data — rounded to 5 dp and never logged at info.
import { z } from "zod";
import type { Location } from "@sensitiv/shared";
import { errorResponse, jsonResponse } from "../../../server/http.ts";
import { describeError, logger } from "../../../server/logger.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The ONLY upstream this handler will ever call. Not configurable. */
const NOMINATIM_REVERSE_URL = "https://nominatim.openstreetmap.org/reverse";

const USER_AGENT =
  "Sensitiv/0.1 (research-assistant; +https://github.com/sensitiv) reverse-geocode";

const FETCH_TIMEOUT_MS = 5_000;
const MIN_REQUEST_INTERVAL_MS = 1_000;

let lastRequestAt = 0;

/** TEST ONLY — reset the process rate-limit window between cases. */
export function __resetGeocodeRateLimit(): void {
  lastRequestAt = 0;
}

const CoordsSchema = z.object({
  lat: z.coerce.number().finite().min(-90).max(90),
  lng: z.coerce.number().finite().min(-180).max(180),
});

const round5 = (n: number): number => Math.round(n * 1e5) / 1e5;

interface NominatimAddress {
  city?: string;
  town?: string;
  village?: string;
  municipality?: string;
  hamlet?: string;
  state?: string;
  province?: string;
  region?: string;
  state_district?: string;
  county?: string;
  country?: string;
  country_code?: string;
  postcode?: string;
}

function mapAddress(address: NominatimAddress): Partial<Location> {
  const city =
    address.city ??
    address.town ??
    address.village ??
    address.municipality ??
    address.hamlet;
  // Nominatim uses state / province / region / state_district by country.
  const region =
    address.state ??
    address.province ??
    address.region ??
    address.state_district ??
    address.county;
  const country = address.country_code
    ? address.country_code.toUpperCase()
    : undefined;

  const mapped: Partial<Location> = {};
  if (city) mapped.city = city;
  if (region) mapped.region = region;
  if (country && country.length === 2) mapped.country = country;
  if (address.country) mapped.countryName = address.country;
  if (address.postcode) mapped.postalCode = address.postcode;
  return mapped;
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  // Only these two params are ever read. A `?url=` / `?host=` / `?server=` param
  // is silently ignored — there is no code path that could act on it.
  const latRaw = url.searchParams.get("lat");
  const lngRaw = url.searchParams.get("lng");
  if (!latRaw || !lngRaw) {
    return errorResponse(400, "lat and lng are required");
  }
  const parsed = CoordsSchema.safeParse({ lat: latRaw, lng: lngRaw });
  if (!parsed.success) {
    return errorResponse(400, "lat and lng must be finite numbers in range");
  }

  const lat = round5(parsed.data.lat);
  const lng = round5(parsed.data.lng);
  const localeParam = url.searchParams.get("locale");
  const locale = localeParam === "fr" ? "fr" : "en";

  const now = Date.now();
  if (now - lastRequestAt < MIN_REQUEST_INTERVAL_MS) {
    return errorResponse(429, "slow down");
  }
  lastRequestAt = now;

  // URL is built ONLY from the hardcoded constant + validated numeric params.
  const upstream = new URL(NOMINATIM_REVERSE_URL);
  upstream.searchParams.set("format", "jsonv2");
  upstream.searchParams.set("lat", String(lat));
  upstream.searchParams.set("lon", String(lng));
  upstream.searchParams.set("zoom", "10");
  upstream.searchParams.set("addressdetails", "1");

  let upstreamBody: unknown;
  try {
    const res = await fetch(upstream, {
      headers: {
        "user-agent": USER_AGENT,
        "accept-language": locale,
        accept: "application/json",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      logger.warn(`geocode upstream returned HTTP ${res.status}`);
      return errorResponse(502, "reverse geocode failed");
    }
    upstreamBody = (await res.json()) as unknown;
  } catch (err) {
    logger.warn(`geocode upstream request failed: ${describeError(err)}`);
    return errorResponse(502, "reverse geocode failed");
  }

  const address =
    upstreamBody && typeof upstreamBody === "object"
      ? ((upstreamBody as { address?: NominatimAddress }).address ?? {})
      : {};

  const mapped = mapAddress(address);
  // `query` is derived ONLY from the five mapped fields — the raw upstream
  // `display_name` and everything else in the body are deliberately dropped.
  const query =
    [mapped.city, mapped.region, mapped.countryName].filter(Boolean).join(", ") ||
    `${lat}, ${lng}`;

  // Return ONLY the mapped `Location` fields, never the raw upstream body.
  return jsonResponse(200, {
    location: {
      query,
      city: mapped.city ?? null,
      region: mapped.region ?? null,
      country: mapped.country ?? null,
      countryName: mapped.countryName ?? null,
      postalCode: mapped.postalCode ?? null,
    },
  });
}
