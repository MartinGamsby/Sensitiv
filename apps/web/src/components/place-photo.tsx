"use client";

import { useState } from "react";

/**
 * Where the dossier gets a place's picture: always our own origin, never the
 * host the URL came from.
 *
 * The row holds a third-party URL; `/api/jobs/:id/places/:key/photo` fetches
 * it server-side, re-validates it and serves the bytes back. See that route
 * for why. `canonicalKey` is the place's identity within a job — the dossier
 * never carries the DB row id — and it is encoded because it is built from a
 * name and a street.
 */
export function placePhotoSrc(jobId: string, canonicalKey: string): string {
  return `/api/jobs/${encodeURIComponent(jobId)}/places/${encodeURIComponent(
    canonicalKey,
  )}/photo`;
}

/**
 * Up to two letters for the tile: the initials of the first two words that
 * start with one.
 *
 * Deliberately not `name.slice(0, 2)` — "L'artisan délices" would read "L'"
 * and "Le Marquis" would read "Le", which is the same two letters as half the
 * list. Falls back to the first character of anything at all rather than
 * rendering an empty square.
 */
export function placeInitials(name: string): string {
  const letters = name
    .split(/[\s\-–—/&,.]+/)
    .map((word) => word.replace(/^[^\p{L}\p{N}]+/u, "").charAt(0))
    .filter((char) => char !== "");
  const picked = letters.slice(0, 2).join("");
  return (picked || name.trim().charAt(0) || "?").toUpperCase();
}

/**
 * A stable hue for a place, 0–359.
 *
 * Derived from the name so the same restaurant is the same colour every time
 * the dossier is opened, and two adjacent cards are almost never the same
 * colour. A plain FNV-style walk: nothing here needs to be a good hash, only
 * a deterministic one.
 */
export function placeHue(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % 360;
}

/**
 * The stand-in when no source offered a photo — or when the one they offered
 * will not load.
 *
 * Not a grey box and not a generic camera glyph: with sixteen results on
 * screen, an identical placeholder on half of them is visual noise that makes
 * the list harder to scan, not easier. Initials plus a hue derived from the
 * name give each card something to recognise it by on the way back down the
 * page, while staying obviously a placeholder rather than pretending to be a
 * photograph of a storefront.
 *
 * `aria-hidden`, like a real photo would be: the name it is generated FROM is
 * the next thing in the reading order.
 */
function InitialsTile({ name, size }: { name: string; size: number }) {
  const hue = placeHue(name);
  return (
    <span
      aria-hidden="true"
      data-testid="place-initials"
      style={{
        width: size,
        height: size,
        // Inline rather than Tailwind: the hue is per place, and a dynamic
        // class name is exactly what the content scanner cannot see.
        backgroundColor: `hsl(${hue} 45% 92%)`,
        color: `hsl(${hue} 55% 28%)`,
        fontSize: Math.round(size * 0.38),
      }}
      className="inline-flex shrink-0 select-none items-center justify-center rounded-md font-semibold tracking-tight dark:brightness-[0.45] dark:saturate-[1.6]"
    >
      {placeInitials(name)}
    </span>
  );
}

export interface PlacePhotoProps {
  jobId: string;
  name: string;
  canonicalKey: string;
  /** Whether any source recorded a photo URL for this place at all. */
  hasPhoto: boolean;
  size?: number;
}

/**
 * A place's photo, or a generated tile — but always SOMETHING, the same size
 * every time.
 *
 * "Always something" is the point. Before, a card with no photo simply had no
 * image element, so its title started at a different x than its neighbours'
 * and a list of sixteen results read as ragged. The tile also covers a photo
 * that 404s or expires after the run, which the old `onError` handled by
 * removing the element and reintroducing the same ragged gap.
 */
export function PlacePhoto({
  jobId,
  name,
  canonicalKey,
  hasPhoto,
  size = 56,
}: PlacePhotoProps) {
  const [failed, setFailed] = useState(false);

  if (!hasPhoto || failed) return <InitialsTile name={name} size={size} />;

  return (
    <img
      // Decorative: the name, address and category right beside it say
      // everything this conveys, so a screen reader gains nothing from a
      // generated description of a stock photo of a storefront.
      src={placePhotoSrc(jobId, canonicalKey)}
      alt=""
      aria-hidden="true"
      loading="lazy"
      decoding="async"
      width={size}
      height={size}
      style={{ width: size, height: size }}
      className="shrink-0 rounded-md bg-surface-muted object-cover"
      onError={() => setFailed(true)}
    />
  );
}
