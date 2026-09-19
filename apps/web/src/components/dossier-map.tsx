"use client";

// The dossier as a map: where the run looked, and where each ranked place is.
//
// Leaflet directly, not react-leaflet — the same call `location-map.tsx`
// makes, and for the same reason: a handful of markers and one circle driven
// imperatively from an effect, against a wrapper whose whole value would be
// turning that into components plus a peer dependency to keep aligned.
//
// MOUNTED ONLY WHEN VISIBLE. Leaflet initialised in a zero-size container
// renders a grey box that only `invalidateSize()` rescues, so the caller
// renders this conditionally rather than hiding it.
import { useEffect, useRef } from "react";
import type { Map as LeafletMap, LayerGroup } from "leaflet";
import "leaflet/dist/leaflet.css";

export interface DossierMapPlace {
  /** 1-based position in the ranked list. */
  rank: number;
  name: string;
  canonicalKey: string;
  lat: number;
  lng: number;
  /** Rendered in the tooltip beside the name, when the run could score it. */
  percent?: number;
}

export interface DossierMapProps {
  places: DossierMapPlace[];
  /** Where the adapters searched. Absent on a run that never resolved one. */
  center?: { lat: number; lng: number };
  /** Drawn as a circle around the centre, so "5 km" is a size not a number. */
  radiusKm?: number;
  /** A pin was clicked. The caller opens that place. */
  onSelect: (canonicalKey: string) => void;
  /** Accessible name for the map region. */
  label: string;
  className?: string;
}

/** Tiles come from OpenStreetMap's own service, whose usage policy requires
 *  attribution and no bulk use. A single-user local app browsing a city is
 *  squarely inside that; the attribution control is not optional. */
const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/**
 * Podium colours for the pins.
 *
 * Deliberately NOT shared with `RankMedal`'s classes, and the duplication is
 * three hex values with a reason: a medal is a background / border / text
 * triple that has to work on two app surfaces, while a pin is a single fill
 * that has to stay legible on top of map tiles it does not control. They
 * mirror each other's hue so the two views read as the same ranking; they
 * cannot share a value.
 */
const PIN_FILL: Record<number, string> = {
  1: "#d97706",
  2: "#64748b",
  3: "#ea580c",
};

/** Everything below the podium is the brand colour, which already tracks the
 *  theme through the token layer. */
const PIN_DEFAULT = "rgb(var(--brand))";

/** Escapes text bound for the `divIcon` / tooltip HTML strings. A place name
 *  is LLM output over scraped pages — it reaches this file as data and must
 *  not reach Leaflet as markup. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** A numbered teardrop. The rank is IN the pin, so the podium colours are
 *  never the only thing saying which is which. */
function pinHtml(rank: number): string {
  const fill = PIN_FILL[rank] ?? PIN_DEFAULT;
  return (
    `<svg viewBox="0 0 28 36" width="28" height="36" aria-hidden="true"` +
    ` style="filter:drop-shadow(0 1px 2px rgb(0 0 0 / .45))">` +
    `<path d="M14 35.5S26 24.6 26 14A12 12 0 1 0 2 14c0 10.6 12 21.5 12 21.5z"` +
    ` fill="${fill}" stroke="#fff" stroke-width="1.6"/>` +
    `<circle cx="14" cy="13.8" r="8" fill="#fff"/>` +
    `<text x="14" y="17.8" text-anchor="middle" font-size="11" font-weight="700"` +
    ` font-family="system-ui, sans-serif" fill="${fill}">${rank}</text>` +
    `</svg>`
  );
}

export function DossierMap({
  places,
  center,
  radiusKm,
  onSelect,
  label,
  className,
}: DossierMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const layerRef = useRef<LayerGroup | null>(null);
  // Read inside Leaflet handlers, which are registered per marker and would
  // otherwise close over the render that created them.
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  // The markers are rebuilt whenever the list changes (a re-sort, a filter),
  // so the effect that draws them needs the newest props without tearing the
  // map itself down and losing the reader's pan and zoom.
  const placesRef = useRef(places);
  placesRef.current = places;

  // --- create once ---------------------------------------------------------
  useEffect(() => {
    const container = containerRef.current;
    if (!container || mapRef.current) return;

    let cancelled = false;

    // Dynamic import, not static: Leaflet touches `window` at module scope,
    // so importing it anywhere reachable from a server render throws.
    void import("leaflet").then((L) => {
      if (cancelled || !containerRef.current) return;

      const map = L.map(container, {
        center: [center?.lat ?? 0, center?.lng ?? 0],
        zoom: 12,
        // One less thing to trap a page scroll on a laptop trackpad; the +/-
        // control and a two-finger gesture still zoom.
        scrollWheelZoom: false,
      });
      mapRef.current = map;
      L.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION, maxZoom: 19 }).addTo(map);
      layerRef.current = L.layerGroup().addTo(map);
    });

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
    // Deliberately `[]` — the draw effect below owns every subsequent update.
  }, []);

  // --- draw the centre, the radius and the pins ----------------------------
  useEffect(() => {
    let cancelled = false;
    void import("leaflet").then((L) => {
      const map = mapRef.current;
      const layer = layerRef.current;
      if (cancelled || !map || !layer) return;
      layer.clearLayers();

      const points: Array<[number, number]> = [];

      if (center) {
        // A hollow ring, visibly not a result: this is where the run looked
        // FROM, and drawing it as another teardrop would make it the 17th
        // place in a list of 16.
        L.circleMarker([center.lat, center.lng], {
          radius: 6,
          color: "rgb(var(--brand))",
          weight: 3,
          fillColor: "rgb(var(--bg))",
          fillOpacity: 1,
        })
          .bindTooltip(escapeHtml(label), { direction: "top" })
          .addTo(layer);
        points.push([center.lat, center.lng]);

        if (radiusKm !== undefined) {
          const circle = L.circle([center.lat, center.lng], {
            radius: radiusKm * 1000,
            color: "rgb(var(--brand))",
            weight: 1,
            fillColor: "rgb(var(--brand))",
            fillOpacity: 0.06,
          }).addTo(layer);
          // The circle's own bounds, so the radius the user asked for is
          // always fully in frame even when every result clusters on one side.
          const b = circle.getBounds();
          points.push([b.getSouth(), b.getWest()], [b.getNorth(), b.getEast()]);
        }
      }

      // Reverse order so rank 1's pin is added last and therefore paints on
      // top of the pins it outranks.
      for (const place of [...placesRef.current].reverse()) {
        const marker = L.marker([place.lat, place.lng], {
          icon: L.divIcon({
            className: "",
            html: pinHtml(place.rank),
            iconSize: [28, 36],
            iconAnchor: [14, 35],
          }),
          // Rank 1 above rank 2 above rank 3, whatever order they were added.
          zIndexOffset: 1000 - place.rank,
          keyboard: true,
          title: place.name,
        });
        const suffix =
          place.percent === undefined ? "" : ` — ${place.percent}%`;
        marker
          .bindTooltip(
            `<strong>${place.rank}. ${escapeHtml(place.name)}</strong>${escapeHtml(suffix)}`,
            { direction: "top" },
          )
          .on("click", () => onSelectRef.current(place.canonicalKey))
          .on("keypress", () => onSelectRef.current(place.canonicalKey))
          .addTo(layer);
        points.push([place.lat, place.lng]);
      }

      if (points.length > 0) {
        map.fitBounds(L.latLngBounds(points), { padding: [28, 28], maxZoom: 16 });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [places, center, radiusKm, label]);

  return (
    <div
      ref={containerRef}
      role="application"
      aria-label={label}
      className={className}
      // Leaflet measures its container on init; a height has to come from
      // somewhere and a class on a ref'd div is the least surprising place
      // for the caller to override it.
      style={{ minHeight: "20rem" }}
    />
  );
}
