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
