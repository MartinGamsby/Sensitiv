"use client";

// Click-to-drop map pin. The v1.1 item from memory/next-steps.md.
//
// Why a map at all: every other way this app learns where to search is an
// inference off text. The forward geocode answers "Quebec, Canada" with a
// province centroid, a postal code covers a whole delivery area, and a desktop
// browser's own `getCurrentPosition` routinely returns an IP-derived regional
// guess. A pin is the one input with no inference in it — the user points at
// the spot, and `Location.pinned` tells everything downstream to stop
// second-guessing it.
//
// Leaflet, not react-leaflet: this is one map with one marker and one circle,
// and the wrapper's whole value is turning that into components with a peer
// dependency to keep aligned. The imperative API fits an effect cleanly.
//
// MOUNTED ONLY WHEN VISIBLE. `Disclosure` hides its content with the `hidden`
// attribute rather than unmounting it (see its own note), and Leaflet
// initialised inside a zero-size container renders a grey box that only
// `invalidateSize()` can rescue. The caller renders this conditionally instead.
import { useEffect, useRef } from "react";
import type { Map as LeafletMap, Marker, Circle } from "leaflet";
import "leaflet/dist/leaflet.css";

export interface MapPoint {
  lat: number;
  lng: number;
}

export interface LocationMapProps {
  /** The current pin, or `undefined` for "nothing dropped yet". */
  value?: MapPoint;
  /** Fires on a click, a marker drag, or a keyboard move. */
  onChange: (point: MapPoint) => void;
  /** Drawn as a circle around the pin, so "5 km" is a size, not a number. */
  radiusKm: number;
  /** Where to open when there is no pin yet. */
  fallbackCenter: MapPoint;
  className?: string;
  /** Accessible name for the map region. */
  label: string;
  /** Read out after a keyboard move, and to screen readers on any change. */
  describePoint: (point: MapPoint) => string;
}

/** Tiles come from OpenStreetMap's own service, whose usage policy requires
 *  attribution and no bulk use. A single-user local app browsing a city is
 *  squarely inside that; the attribution control is not optional. */
const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/** Zoom for a given radius, so dropping a 1 km pin does not leave the user
 *  staring at a whole province. Mirrors `zoomForRadiusKm` in the shared schema;
 *  kept here rather than imported because that one describes a Google Maps
 *  viewport and this one a Leaflet one, and they are free to diverge. */
function zoomFor(radiusKm: number): number {
  if (radiusKm <= 1) return 14;
  if (radiusKm <= 3) return 13;
  if (radiusKm <= 5) return 12;
  return 11;
}

/** How far an arrow key nudges the pin: about a tenth of the radius, so the
 *  same gesture stays useful at 1 km and at 10 km. */
function stepDegrees(radiusKm: number): number {
  return Math.max(0.0002, radiusKm / 1110);
}

export function LocationMap({
  value,
  onChange,
  radiusKm,
  fallbackCenter,
  className,
  label,
  describePoint,
}: LocationMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const circleRef = useRef<Circle | null>(null);
  // Read inside Leaflet event handlers, which are registered once and would
  // otherwise close over the first render's props forever.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // --- create once ---------------------------------------------------------
  useEffect(() => {
    const container = containerRef.current;
    if (!container || mapRef.current) return;

    let cancelled = false;
    let map: LeafletMap | undefined;

    // Dynamic import, not a static one: Leaflet touches `window` at module
    // scope, so importing it anywhere reachable from a server render throws.
    void import("leaflet").then((L) => {
      if (cancelled || !containerRef.current) return;

      map = L.map(container, {
        center: [value?.lat ?? fallbackCenter.lat, value?.lng ?? fallbackCenter.lng],
        zoom: zoomFor(radiusKm),
        // One less thing to trap a page scroll on a laptop trackpad; the +/-
        // control and a two-finger gesture still zoom.
        scrollWheelZoom: false,
      });
      mapRef.current = map;

      L.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION, maxZoom: 19 }).addTo(map);

      // A `divIcon`, not the default marker: Leaflet's default icon resolves
      // its PNGs relative to the CSS file, which breaks under every bundler
      // and is normally patched with `mergeOptions` + CDN URLs. Inline SVG
      // needs no assets at all and inherits the app's theme tokens.
      const icon = L.divIcon({
        className: "",
        html: `<svg viewBox="0 0 24 24" width="32" height="32" aria-hidden="true"
                    style="filter:drop-shadow(0 1px 2px rgb(0 0 0 / .4))">
                 <path d="M12 22s7-6.1 7-12a7 7 0 1 0-14 0c0 5.9 7 12 7 12z"
                       fill="rgb(var(--brand))" stroke="white" stroke-width="1.5"/>
                 <circle cx="12" cy="10" r="2.5" fill="white"/>
               </svg>`,
        iconSize: [32, 32],
        iconAnchor: [16, 30],
      });

      const start = value ?? fallbackCenter;
      const marker = L.marker([start.lat, start.lng], {
        icon,
        draggable: true,
        keyboard: true,
        // Without a pin yet the marker is a suggestion, not an answer; the
        // caller shows it faded and does not treat it as a value.
        opacity: value ? 1 : 0.45,
      }).addTo(map);
      markerRef.current = marker;

      const circle = L.circle([start.lat, start.lng], {
        radius: radiusKm * 1000,
        color: "rgb(var(--brand))",
        weight: 1,
        fillColor: "rgb(var(--brand))",
        fillOpacity: 0.08,
      }).addTo(map);
      circleRef.current = circle;

      map.on("click", (e) => {
        onChangeRef.current({ lat: e.latlng.lat, lng: e.latlng.lng });
      });
      marker.on("dragend", () => {
        const p = marker.getLatLng();
        onChangeRef.current({ lat: p.lat, lng: p.lng });
      });
    });

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      markerRef.current = null;
      circleRef.current = null;
    };
    // Deliberately `[]`. `value` / `radiusKm` / `fallbackCenter` are read for
    // the INITIAL view only; the two effects below keep them in sync
    // afterwards, and re-running this one would tear the map down and rebuild
    // it (losing the user's zoom) on every pin move.
  }, []);

  // --- follow the pin ------------------------------------------------------
  useEffect(() => {
    const marker = markerRef.current;
    const circle = circleRef.current;
    const map = mapRef.current;
    if (!marker || !circle || !map || !value) return;
    marker.setLatLng([value.lat, value.lng]);
    marker.setOpacity(1);
    circle.setLatLng([value.lat, value.lng]);
    // `panTo`, not `setView`: re-centring at a fixed zoom on every change would
    // fight a user who has zoomed in to place the pin precisely.
    map.panTo([value.lat, value.lng]);
  }, [value]);

  // --- follow the radius ---------------------------------------------------
  useEffect(() => {
    const circle = circleRef.current;
    const map = mapRef.current;
    if (!circle || !map) return;
    circle.setRadius(radiusKm * 1000);
    // Fit the new circle rather than guessing a zoom: changing 1 km -> 10 km
    // should show the user what they just asked for.
    map.fitBounds(circle.getBounds(), { padding: [16, 16] });
  }, [radiusKm]);

  // Keyboard placement, because a click target is not an input everyone can
  // use. Arrow keys nudge the pin; the container is focusable and labelled.
  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const deltas: Record<string, [number, number]> = {
      ArrowUp: [1, 0],
      ArrowDown: [-1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    };
    const delta = deltas[e.key];
    if (!delta) return;
    e.preventDefault();
    const base = value ?? fallbackCenter;
    const step = stepDegrees(radiusKm);
    onChange({
      lat: Math.min(90, Math.max(-90, base.lat + delta[0] * step)),
      lng: Math.min(180, Math.max(-180, base.lng + delta[1] * step)),
    });
  }

  return (
    <>
      <div
        ref={containerRef}
        role="application"
        aria-label={label}
        tabIndex={0}
        onKeyDown={onKeyDown}
        className={className}
        // Leaflet measures its container on init; a height has to come from
        // somewhere and a Tailwind class on a ref'd div is the least surprising
        // place for the caller to override it.
        style={{ minHeight: "18rem" }}
      />
      {/* The pin's position in words. A map is not readable to everyone, and
          this is also what makes the arrow-key nudge verifiable. */}
      <p aria-live="polite" className="sr-only">
        {value ? describePoint(value) : ""}
      </p>
    </>
  );
}
