// Cross-source place merge. `canonicalKey` — lowercase, strip accents, strip
// punctuation, name + first street token, collapse whitespace — is the identity:
// "Cafe Resonance / 5175 Av du Parc" and "Cafe Resonance, 5175 Park Ave" collapse
// to one place.
import {
  PlaceDetailSchema,
  type Evidence,
  type PlaceDetail,
  type PlaceSource,
} from "@sensitiv/shared";
import type { PlaceFinding } from "./adapters/types.ts";

const COMBINING_MARKS = /[̀-ͯ]/g;

export function normalizeText(input: string): string {
  return input
    .normalize("NFKD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function firstStreetToken(address: string | undefined): string {
  if (!address) return "";
  const normalized = normalizeText(address);
  const number = normalized.match(/\d+/);
  if (number) return number[0];
  return normalized.split(" ")[0] ?? "";
}

export function canonicalKey(name: string, address?: string): string {
  const base = normalizeText(name);
  const token = firstStreetToken(address);
  return [base, token].filter((part) => part !== "").join(" ");
}

export interface MergedPlace {
  place: PlaceDetail;
  sources: PlaceSource[];
  evidence: Evidence[];
}

function preferLonger(
  a: string | undefined,
  b: string | undefined,
): string | undefined {
  if (!a) return b;
  if (!b) return a;
  return b.length > a.length ? b : a;
}

/** Group findings by canonical key; union sources and evidence, keep the fullest fields. */
export function mergeFindings(findings: readonly PlaceFinding[]): MergedPlace[] {
  const byKey = new Map<string, MergedPlace>();
  const order: string[] = [];

  for (const finding of findings) {
    const key =
      finding.place.canonicalKey ||
      canonicalKey(finding.place.name, finding.place.address);
    const existing = byKey.get(key);

    if (!existing) {
      byKey.set(key, {
        place: PlaceDetailSchema.parse({ ...finding.place, canonicalKey: key }),
        sources: [finding.source],
        evidence: [...finding.evidence],
      });
      order.push(key);
      continue;
    }

    existing.place = PlaceDetailSchema.parse({
      ...existing.place,
      address: preferLonger(existing.place.address, finding.place.address),
      category: existing.place.category ?? finding.place.category,
      phone: existing.place.phone ?? finding.place.phone,
      url: existing.place.url ?? finding.place.url,
      lat: existing.place.lat ?? finding.place.lat,
      lng: existing.place.lng ?? finding.place.lng,
      canonicalKey: key,
    });
    if (
      !existing.sources.some(
        (s) =>
          s.source === finding.source.source &&
          s.sourceUrl === finding.source.sourceUrl,
      )
    ) {
      existing.sources.push(finding.source);
    }
    existing.evidence.push(...finding.evidence);
  }

  return order.map((key) => {
    const merged = byKey.get(key);
    if (!merged) throw new Error(`mergeFindings: lost key ${key}`);
    return merged;
  });
}
