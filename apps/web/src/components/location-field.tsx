"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";

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
}

export interface LocationFieldProps {
  value: LocationDraft;
  onChange: (next: LocationDraft) => void;
  /** Test seam: defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}

type GeoStatus = "idle" | "locating" | "error";

export function LocationField({ value, onChange, fetchImpl }: LocationFieldProps) {
  const t = useTranslations("form");
  const locale = useLocale();
  const [status, setStatus] = useState<GeoStatus>("idle");
  const [errorKey, setErrorKey] = useState<
    "denied" | "unavailable" | "insecure" | "lookupFailed" | null
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
        void reverseGeocode(position.coords.latitude, position.coords.longitude);
      },
      (err) => {
        setStatus("error");
        setErrorKey(
          err && err.code === err.PERMISSION_DENIED ? "denied" : "unavailable",
        );
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 },
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
      });
      setStatus("idle");
    } catch {
      setStatus("error");
      setErrorKey("lookupFailed");
    }
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <div className="flex flex-1 flex-col gap-1">
        <label className="text-sm font-medium" htmlFor="location-query">
          {t("location.label")}
        </label>
        <input
          id="location-query"
          type="text"
          required
          value={value.query}
          placeholder={t("location.placeholder")}
          onChange={(e) => onChange({ ...value, query: e.target.value })}
          className="rounded border border-gray-300 bg-transparent px-2 py-1.5 text-sm dark:border-gray-700"
        />
      </div>

      <div className="flex w-full flex-col gap-1 sm:w-40">
        <label className="text-sm font-medium" htmlFor="location-postal">
          {t("postal.label")}
        </label>
        <input
          id="location-postal"
          type="text"
          maxLength={12}
          value={value.postalCode}
          placeholder={t("postal.placeholder")}
          onChange={(e) => onChange({ ...value, postalCode: e.target.value })}
          className="rounded border border-gray-300 bg-transparent px-2 py-1.5 text-sm dark:border-gray-700"
        />
      </div>

      <div className="flex flex-col gap-1">
        <button
          type="button"
          onClick={useMyLocation}
          disabled={status === "locating"}
          className="rounded border border-gray-300 px-3 py-1.5 text-sm hover:border-gray-500 disabled:opacity-60 dark:border-gray-700"
        >
          {status === "locating" ? t("locating") : t("useMyLocation")}
        </button>
        {status === "error" && errorKey ? (
          <p role="alert" className="text-xs text-red-600 dark:text-red-400">
            {t(`geo.${errorKey}`)}
          </p>
        ) : null}
      </div>
    </div>
  );
}
