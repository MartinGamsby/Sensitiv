// GET /api/geocode?lat=&lng=[&locale=]  — server-side REVERSE geocode proxy.
// GET /api/geocode?q=[&country=][&locale=] — server-side FORWARD geocode proxy.
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
import { isCoarseBoundingBox, type Location } from "@sensitiv/shared";
import { errorResponse, jsonResponse } from "../../../server/http.ts";
import { describeError, logger } from "../../../server/logger.ts";
// Rate-limit state + its test-only reset live in a sidecar module: a Next.js
// route file may only export the recognised handler/config names.
import { geocodeRateLimit } from "./rate-limit.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The ONLY upstreams this handler will ever call. Not configurable. */
const NOMINATIM_REVERSE_URL = "https://nominatim.openstreetmap.org/reverse";
const NOMINATIM_SEARCH_URL = "https://nominatim.openstreetmap.org/search";

/** Longest free-text place query accepted. A location, not an essay. */
const MAX_QUERY_LENGTH = 200;

const USER_AGENT =
  "Sensitiv/0.1 (research-assistant; +https://github.com/sensitiv) reverse-geocode";

const FETCH_TIMEOUT_MS = 5_000;
const MIN_REQUEST_INTERVAL_MS = 1_000;

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

/**
 * The single fetch both modes go through. `upstream` is ALWAYS built by the
 * caller from one of the two hardcoded constants above plus validated params —
 * never from anything a client sent.
 */
async function callNominatim(
  upstream: URL,
  locale: string,
): Promise<unknown | undefined> {
  try {
    const res = await fetch(upstream, {
      headers: {
        "user-agent": USER_AGENT,
        "accept-language": locale,
        accept: "application/json",
      },
      // A followed redirect would walk the request straight off the allowlisted
      // origin (`302 -> http://169.254.169.254/…`), which is the exact thing the
      // hardcoded origin exists to prevent. Reject instead of following.
      redirect: "error",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      logger.warn(`geocode upstream returned HTTP ${res.status}`);
      return undefined;
    }
    return (await res.json()) as unknown;
  } catch (err) {
    logger.warn(`geocode upstream request failed: ${describeError(err)}`);
    return undefined;
  }
}

/**
 * Forward geocode: free text (+ optional country hint) -> a `Location`.
 *
 * This is the half that was missing, and its absence is why a typed postal code
 * did nothing at all: the app could turn coordinates into a place name but had
 * no way to turn a place name into coordinates, so whatever the user typed went
 * to the search adapters as an unverified string.
 *
 * Note what this CANNOT do: OpenStreetMap has essentially no Canadian postal
 * code data (Canada Post licenses it), so "H1S" resolves to nothing here in
 * every phrasing — structured `postalcode=`, `q=`, with or without
 * `countrycodes=ca`. The worker's Google Maps viewport hop is what covers
 * postal codes; this covers the city/neighbourhood text next to it.
 */
async function forwardGeocode(
  query: string,
  locale: string,
  country: string | undefined,
): Promise<Response> {
  const upstream = new URL(NOMINATIM_SEARCH_URL);
  upstream.searchParams.set("format", "jsonv2");
  upstream.searchParams.set("q", query);
  upstream.searchParams.set("addressdetails", "1");
  upstream.searchParams.set("limit", "1");
  if (country) upstream.searchParams.set("countrycodes", country.toLowerCase());

  const body = await callNominatim(upstream, locale);
  if (body === undefined) return errorResponse(502, "geocode failed");

  const hit = Array.isArray(body) ? (body[0] as Record<string, unknown> | undefined) : undefined;
  if (!hit) {
    // A miss is a legitimate answer, not a server error: the caller falls back
    // to sending the raw text and letting the search adapters anchor it.
    return jsonResponse(200, { location: null });
  }

  const address =
    typeof hit.address === "object" && hit.address !== null
      ? (hit.address as NominatimAddress)
      : {};
  const mapped = mapAddress(address);
  const lat = Number(hit.lat);
  const lng = Number(hit.lon);
  const usable = Number.isFinite(lat) && Number.isFinite(lng) && !isCoarseBoundingBox(hit.boundingbox);

  return jsonResponse(200, {
    location: {
      // The text the user typed stays authoritative for display; only the
      // structured fields and the coordinates come from upstream.
      query,
      city: mapped.city ?? null,
      region: mapped.region ?? null,
      country: mapped.country ?? null,
      countryName: mapped.countryName ?? null,
      postalCode: mapped.postalCode ?? null,
      // Structured fields survive even when the coordinates are rejected below:
      // knowing the country is still worth having.
      lat: usable ? round5(lat) : null,
      lng: usable ? round5(lng) : null,
    },
  });
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  // Only these params are ever read. A `?url=` / `?host=` / `?server=` param
  // is silently ignored — there is no code path that could act on it.
  const latRaw = url.searchParams.get("lat");
  const lngRaw = url.searchParams.get("lng");
  const queryRaw = url.searchParams.get("q");
  if (!latRaw && !lngRaw && !queryRaw) {
    return errorResponse(400, "lat and lng, or q, are required");
  }
  if (!queryRaw && (!latRaw || !lngRaw)) {
    return errorResponse(400, "lat and lng are required");
  }
  const localeParam = url.searchParams.get("locale");
  const locale = localeParam === "fr" ? "fr" : "en";

  // One shared window across BOTH modes: Nominatim's usage policy is one
  // request per second per client, not per endpoint.
  const now = Date.now();
  if (now - geocodeRateLimit.lastRequestAt < MIN_REQUEST_INTERVAL_MS) {
    return errorResponse(429, "slow down");
  }
  geocodeRateLimit.lastRequestAt = now;

  // --- forward mode -------------------------------------------------------
  if (queryRaw) {
    const query = queryRaw.trim();
    if (query === "") return errorResponse(400, "q must not be empty");
    if (query.length > MAX_QUERY_LENGTH) {
      return errorResponse(400, "q is too long");
    }
    const countryRaw = url.searchParams.get("country");
    // Two ASCII letters or nothing. Anything else is dropped rather than
    // forwarded, so a hostile value can never reach the upstream query string.
    const country =
      countryRaw && /^[A-Za-z]{2}$/.test(countryRaw) ? countryRaw : undefined;
    return forwardGeocode(query, locale, country);
  }

  // --- reverse mode -------------------------------------------------------
  const parsed = CoordsSchema.safeParse({ lat: latRaw, lng: lngRaw });
  if (!parsed.success) {
    return errorResponse(400, "lat and lng must be finite numbers in range");
  }

  const lat = round5(parsed.data.lat);
  const lng = round5(parsed.data.lng);

  // URL is built ONLY from the hardcoded constant + validated numeric params.
  const upstream = new URL(NOMINATIM_REVERSE_URL);
  upstream.searchParams.set("format", "jsonv2");
  upstream.searchParams.set("lat", String(lat));
  upstream.searchParams.set("lon", String(lng));
  upstream.searchParams.set("zoom", "10");
  upstream.searchParams.set("addressdetails", "1");

  const upstreamBody = await callNominatim(upstream, locale);
  if (upstreamBody === undefined) {
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
      // The caller ALREADY has these — they are what it asked about — but it
      // used to drop them on the floor, which left the one moment the app holds
      // real coordinates producing a `Location` with none. Echoing them back
      // (rounded, as everywhere else) is what lets the search anchor on a map
      // point instead of on a place name.
      lat,
      lng,
    },
  });
}
