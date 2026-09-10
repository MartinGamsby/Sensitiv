import { describe, expect, it } from "vitest";
import { canonicalKey, mergeFindings, normalizeText } from "./merge.ts";
import type { PlaceFinding } from "./adapters/types.ts";

describe("canonicalKey", () => {
  it("strips accents / punctuation and keeps name + first street token", () => {
    expect(canonicalKey("Café Résonance", "5175 Av du Parc")).toBe(
      canonicalKey("Cafe Resonance", "5175 Park Ave"),
    );
    expect(canonicalKey("Café Résonance", "5175 Av du Parc")).toBe(
      "cafe resonance 5175",
    );
  });

  it("normalizeText collapses whitespace and drops diacritics", () => {
    expect(normalizeText("  Épicerie   Bio-Terre! ")).toBe("epicerie bio terre");
  });
});

describe("mergeFindings", () => {
  const finding = (name: string, address: string, source: string): PlaceFinding => ({
    place: { name, address, canonicalKey: canonicalKey(name, address) },
    source: { source, sourceUrl: `https://${source}.example/x` },
    evidence: [],
  });

  it("collapses the same place seen across two sources into one", () => {
    const merged = mergeFindings([
      finding("Café Résonance", "5175 Av du Parc", "google_maps"),
      finding("Cafe Resonance", "5175 Park Ave", "yelp"),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.sources.map((s) => s.source).sort()).toEqual([
      "google_maps",
      "yelp",
    ]);
  });

  it("keeps distinct places apart", () => {
    const merged = mergeFindings([
      finding("Café A", "1 Rue Rachel", "google_maps"),
      finding("Café B", "2 Rue Rachel", "google_maps"),
    ]);
    expect(merged).toHaveLength(2);
  });
});
