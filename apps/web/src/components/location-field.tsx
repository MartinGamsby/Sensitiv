"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Button, Field, Input, Spinner } from "./ui/index.ts";
import { CrosshairIcon, PinIcon } from "./ui/icon.tsx";

// TODO(v1.1): map pin. Leaflet + Nominatim click-to-drop with a 1/3/5/10 km
// radius select. Text search + optional postal/ZIP ships first; the structured
// lat/lng/radiusKm fields already exist on the shared `Location` schema.

export interface LocationDraft {
  query: string;
  postalCode: string;
  city?: string;
  region?: string;
  country?: string;
  countryName?: string;
  /** Resolved coordinates, when a geocode produced them. These are what let a
   *  search anchor on a map point instead of on a place NAME, which is the
   *  difference between searching Montreal and searching whatever Google
   *  decides "Quebec, Canada" means. */
  lat?: number;
  lng?: number;
}

export interface LocationFieldProps {
  value: LocationDraft;
  onChange: (next: LocationDraft) => void;
  /** Test seam: defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}

type GeoStatus = "idle" | "locating" | "error";

/**
 * Worst fix we will treat as "where the user is".
 *
 * `getCurrentPosition` always reports `coords.accuracy` in metres, and we were
 * throwing it away along with the coordinates themselves. On a desktop with no
 * GPS the browser falls back to IP geolocation, which routinely answers with a
 * REGIONAL centroid and an accuracy radius of tens or hundreds of kilometres.
 * Reverse-geocoding a point like that is how the location field came to read
 * "Quebec, Canada": the fix landed in unpopulated Nord-du-Quebec, Nominatim
 * correctly reported no city there, and the app quietly built a province-wide
 * "location" out of it and searched from the resulting centroid.
 *
 * 5 km is generous — a neighbourhood search wants a fix good to a few hundred
 * metres — but it is comfortably inside "this is a real place" while excluding
 * every IP-derived guess.
 */
const COARSE_FIX_METERS = 5_000;

export function LocationField({ value, onChange, fetchImpl }: LocationFieldProps) {
  const t = useTranslations("form");
  const locale = useLocale();
  const [status, setStatus] = useState<GeoStatus>("idle");
  const [errorKey, setErrorKey] = useState<
    "denied" | "unavailable" | "insecure" | "lookupFailed" | "coarse" | null
  >(null);

  const doFetch = fetchImpl ?? globalThis.fetch.bind(globalThis);

  function useMyLocation() {
    setErrorKey(null);

    const geo =
      typeof navigator !== "undefined" ? navigator.geolocation : undefined;

    // Geolocation needs a secure context. `localhost` counts; a LAN IP does not.
    const host =
      typeof window === "undefined" ? "localhost" : window.location.hostname;
    const secure =
      typeof window === "undefined" ||
      window.isSecureContext !== false ||
      host === "localhost" ||
      host === "127.0.0.1";

    if (!secure) {
      setStatus("error");
      setErrorKey("insecure");
      return;
    }
    if (!geo) {
      setStatus("error");
      setErrorKey("unavailable");
      return;
    }

    setStatus("locating");
    // Geolocation is requested ONLY here, on an explicit click — never on load.
    geo.getCurrentPosition(
      (position) => {
        const { latitude, longitude, accuracy } = position.coords;
        if (accuracy > COARSE_FIX_METERS) {
          // Say so instead of silently searching the middle of a province.
          // The field is left exactly as the user had it: a name derived from
          // a fix this vague is misinformation, not a helpful default.
          setStatus("error");
          setErrorKey("coarse");
          return;
        }
        void reverseGeocode(latitude, longitude);
      },
      (err) => {
        setStatus("error");
        setErrorKey(
          err && err.code === err.PERMISSION_DENIED ? "denied" : "unavailable",
        );
      },
      // `enableHighAccuracy` is what makes a laptop consult WiFi rather than
      // settle for its IP address, which is the difference between a fix good
      // to ~50 m and one good to ~250 km. It costs a little battery and a
      // little time, hence the longer timeout; the button is an explicit click,
      // so the user is already waiting for exactly this.
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
    );
  }

  async function reverseGeocode(lat: number, lng: number) {
    try {
      const res = await doFetch(
        `/api/geocode?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(
          lng,
        )}&locale=${locale}`,
      );
      if (!res.ok) throw new Error(`geocode ${res.status}`);
      const body = (await res.json()) as {
        location?: {
          query?: string | null;
          city?: string | null;
          region?: string | null;
          country?: string | null;
          countryName?: string | null;
          postalCode?: string | null;
          lat?: number | null;
          lng?: number | null;
        };
      };
      const loc = body.location ?? {};
      onChange({
        ...value,
        query: loc.query ?? value.query,
        city: loc.city ?? undefined,
        region: loc.region ?? undefined,
        country: loc.country ?? undefined,
        countryName: loc.countryName ?? undefined,
        postalCode: loc.postalCode ?? value.postalCode,
        // These were being thrown away: the browser handed us exact
        // coordinates, we spent a round trip turning them into a place name,
        // and then kept only the name.
        lat: loc.lat ?? lat,
        lng: loc.lng ?? lng,
      });
      setStatus("idle");
    } catch {
      setStatus("error");
      setErrorKey("lookupFailed");
    }
  }

  const locating = status === "locating";

  return (
    <div className="flex flex-col gap-3">
      <Field
        htmlFor="location-query"
        label={t("location.label")}
        error={status === "error" && errorKey ? t(`geo.${errorKey}`) : undefined}
      >
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <PinIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle" />
            <Input
              id="location-query"
              type="text"
              required
              value={value.query}
              placeholder={t("location.placeholder")}
              onChange={(e) =>
                onChange({
                  ...value,
                  query: e.target.value,
                  // Coordinates describe the text they were resolved FROM.
                  // Keeping them across an edit is how a search ends up pinned
                  // to the previous location while displaying the new one.
                  lat: undefined,
                  lng: undefined,
                  city: undefined,
                })
              }
              className="h-11 pl-9 text-base sm:text-sm"
            />
          </div>
          <Button
            onClick={useMyLocation}
            disabled={locating}
            className="h-11 shrink-0"
            icon={locating ? <Spinner className="h-4 w-4" /> : <CrosshairIcon />}
          >
            {locating ? t("locating") : t("useMyLocation")}
          </Button>
        </div>
      </Field>

      <Field
        htmlFor="location-postal"
        label={t("postal.label")}
        adornment={t("optional")}
        hint={t("postal.hint")}
        className="sm:max-w-[14rem]"
      >
        <Input
          id="location-postal"
          type="text"
          maxLength={12}
          value={value.postalCode}
          placeholder={t("postal.placeholder")}
          onChange={(e) =>
            onChange({ ...value, postalCode: e.target.value, lat: undefined, lng: undefined })
          }
        />
      </Field>
    </div>
  );
}
