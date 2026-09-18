"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Button, Disclosure, Field, Input, Select, Spinner } from "./ui/index.ts";
import { CrosshairIcon, MapIcon, PinIcon } from "./ui/icon.tsx";
import type { MapPoint } from "./location-map.tsx";

/**
 * Leaflet touches `window` at module scope, so the map can never be part of a
 * server render — hence `ssr: false`, which is legal here because this file is
 * already a client component. It also keeps ~150 KB of mapping code out of the
 * bundle for everyone who never opens the panel.
 */
const LocationMap = dynamic(
  () => import("./location-map.tsx").then((m) => m.LocationMap),
  { ssr: false },
);

/** Radius options, in km. The search radius is what turns a point into an
 *  area, and it is the one number the score's proximity term reads. */
export const RADIUS_OPTIONS_KM = [1, 3, 5, 10] as const;

/** Where the map opens when there is nothing to centre on yet. Montreal,
 *  because that is the city every fixture and preset in this repo is about. */
const DEFAULT_MAP_CENTER: MapPoint = { lat: 45.5233, lng: -73.5858 };

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
  /** Radius the search covers, in km. */
  radiusKm?: number;
  /**
   * The coordinates came from a pin the user dropped, not from a geocode.
   *
   * Carried through to `Location.pinned`, where it inverts the usual ranking:
   * geocoded coordinates lose to a postal code (they are coarser by
   * definition), but a pin beats one, because pointing at a spot is finer than
   * naming a delivery area.
   */
  pinned?: boolean;
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
  // The map is MOUNTED only while open. `Disclosure` hides its content with
  // `hidden` rather than unmounting, and Leaflet initialised in a zero-size
  // container renders a grey box nothing but `invalidateSize()` can fix.
  const [mapOpen, setMapOpen] = useState(false);
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
      // `null` is a legitimate answer, not a transport failure: the route
      // refuses to name a place when it cannot resolve a CITY, rather than
      // handing back the province the point falls in. Treat it as a miss and
      // leave the field exactly as the user had it.
      const loc = body.location;
      if (!loc || !loc.city) {
        setStatus("error");
        setErrorKey("lookupFailed");
        return;
      }
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

  /**
   * Place the pin.
   *
   * The coordinates are the answer as soon as they are set — the reverse
   * geocode that follows is only there to give the spot a NAME, for the
   * dossier and for the adapters' text queries. A failed lookup therefore
   * leaves the pin exactly where the user put it and keeps whatever text was
   * already in the field, rather than undoing their click.
   */
  function dropPin(point: MapPoint) {
    setErrorKey(null);
    onChange({
      ...value,
      lat: point.lat,
      lng: point.lng,
      pinned: true,
      // A pin is finer than a delivery area, so the postal code has nothing
      // left to contribute and would only muddy the adapters' query text.
      postalCode: "",
    });
    void namePin(point);
  }

  /** Best-effort: fills the text field from the pin, never clears it. */
  async function namePin(point: MapPoint) {
    try {
      const res = await doFetch(
        `/api/geocode?lat=${encodeURIComponent(point.lat)}&lng=${encodeURIComponent(
          point.lng,
        )}&locale=${locale}`,
      );
      if (!res.ok) return;
      const body = (await res.json()) as { location?: { query?: string | null } | null };
      const named = body.location;
      if (!named?.query) return;
      onChange({
        ...value,
        query: named.query,
        lat: point.lat,
        lng: point.lng,
        pinned: true,
        postalCode: "",
      });
    } catch {
      /* the pin is the answer; the name is a nicety */
    }
  }

  const radiusKm = value.radiusKm ?? 5;
  const pin =
    value.lat !== undefined && value.lng !== undefined
      ? { lat: value.lat, lng: value.lng }
      : undefined;
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

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <Field
          htmlFor="location-postal"
          label={t("postal.label")}
          adornment={t("optional")}
          hint={t("postal.hint")}
          className="sm:max-w-[14rem] sm:flex-1"
        >
          <Input
            id="location-postal"
            type="text"
            maxLength={12}
            value={value.postalCode}
            placeholder={t("postal.placeholder")}
            onChange={(e) =>
              onChange({
                ...value,
                postalCode: e.target.value,
                // Typed text and a dropped pin are different answers to the
                // same question; keeping both would leave the search anchored
                // somewhere the form no longer shows.
                lat: undefined,
                lng: undefined,
                pinned: undefined,
              })
            }
          />
        </Field>

        <Field
          htmlFor="location-radius"
          label={t("radius.label")}
          hint={t("radius.hint")}
          className="sm:max-w-[12rem] sm:flex-1"
        >
          <Select
            id="location-radius"
            value={radiusKm}
            onChange={(e) => onChange({ ...value, radiusKm: Number(e.target.value) })}
          >
            {RADIUS_OPTIONS_KM.map((km) => (
              <option key={km} value={km}>
                {t("radius.km", { count: km })}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {/* The one input with no inference in it. Everything else here is a
          guess off text: the forward geocode answers "Quebec, Canada" with a
          province centroid, a postal code covers a whole delivery area, and a
          desktop's own location is usually its IP address. */}
      <Disclosure
        summary={
          <span className="inline-flex items-center gap-2">
            <MapIcon className="h-4 w-4" />
            {t("map.label")}
          </span>
        }
        meta={pin && value.pinned ? t("map.pinned") : undefined}
        open={mapOpen}
        onOpenChange={setMapOpen}
        triggerClassName="px-1"
        contentClassName="pt-2"
      >
        {mapOpen ? (
          <div className="flex flex-col gap-2">
            <LocationMap
              value={pin}
              onChange={dropPin}
              radiusKm={radiusKm}
              fallbackCenter={pin ?? DEFAULT_MAP_CENTER}
              label={t("map.ariaLabel")}
              describePoint={(p) =>
                t("map.pinAt", { lat: p.lat.toFixed(4), lng: p.lng.toFixed(4) })
              }
              className="overflow-hidden rounded-xl border border-border-subtle"
            />
            <p className="px-1 text-xs text-fg-muted">
              {pin && value.pinned
                ? t("map.pinAt", { lat: pin.lat.toFixed(4), lng: pin.lng.toFixed(4) })
                : t("map.hint")}
            </p>
          </div>
        ) : null}
      </Disclosure>
    </div>
  );
}
