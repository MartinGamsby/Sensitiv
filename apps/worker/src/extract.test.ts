import { describe, expect, it } from "vitest";
import { FakeLlmProvider } from "@sensitiv/shared/llm";
import {
  extractFindings,
  ExtractionSchema,
  normalizeForQuoteMatch,
  quoteAppearsIn,
} from "./extract.ts";

const noopLog = async (): Promise<void> => undefined;
const searchLang = { code: "fr", source: "auto" as const };

describe("extractFindings", () => {
  it("maps a blob to findings and drops quotes absent from the blob", async () => {
    const blob = {
      results: [
        { name: "Test Cafe", address: "1 Main St", reviews: ["real quote here"] },
      ],
    };
    const llm = new FakeLlmProvider({
      handler: () => ({
        places: [
          {
            name: "Test Cafe",
            address: "1 Main St",
            evidence: [
              {
                requirementId: "celiac",
                claim: "verified",
                polarity: "supports",
                quote: "real quote here",
                confidence: 0.9,
              },
              {
                requirementId: "celiac",
                claim: "fabricated",
                polarity: "supports",
                quote: "this was never in the blob",
                confidence: 0.9,
              },
            ],
          },
        ],
      }),
    });

    const findings = await extractFindings(blob, {
      source: "google_maps",
      sourceUrl: "https://maps.example/x",
      requirements: [],
      uiLocale: "en",
      searchLang,
      llm,
      signal: new AbortController().signal,
      log: noopLog,
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.evidence.map((e) => e.quote)).toEqual(["real quote here"]);
    expect(findings[0]?.place.canonicalKey).toBe("test cafe 1");
  });

  it("returns [] (does not throw) when the model keeps violating the schema", async () => {
    const llm = new FakeLlmProvider({ handler: () => ({ places: "not an array" }) });
    const findings = await extractFindings(
      { results: [] },
      {
        source: "google_maps",
        sourceUrl: "https://maps.example/x",
        requirements: [],
        uiLocale: "en",
        searchLang,
        llm,
        signal: new AbortController().signal,
        log: noopLog,
      },
    );
    expect(findings).toEqual([]);
  });

  it("the committed google_maps fixture parses against the live extraction schema", async () => {
    const { readFileSync } = await import("node:fs");
    const url = new URL("../fixtures/google-maps-plateau.json", import.meta.url);
    const fixture = JSON.parse(readFileSync(url, "utf8")) as { extraction: unknown };
    expect(() => ExtractionSchema.parse(fixture.extraction)).not.toThrow();
  });
});

describe("quoteAppearsIn — the fabricated-quote guard", () => {
  // The guard compares the model's quote against the scraped SOURCE STRINGS.
  // It used to compare against `JSON.stringify(blob)`, and the two differ in
  // ways the model has no control over — so honest evidence was thrown away and
  // the log blamed the model for it. Observed live: a bakery called
  // "Parc Sans Gluten" lost its only celiac support on job 906508d9.
  const card = {
    name: "Parc Sans Gluten",
    snippet:
      "Parc Sans Gluten\n4,8(212)\nBoulangerie sans gluten\n4050 Av. du Parc-La Fontaine",
  };
  const blob = { results: [card] };

  it("accepts a quote that spans a line break", () => {
    // THE regression. `card.innerText` is multi-line by construction, so in the
    // stringified blob every newline is the two characters backslash + n, while
    // the model's reply comes back through `JSON.parse` with a real newline.
    // Any quote crossing a line failed — always, not occasionally.
    expect(
      quoteAppearsIn("Boulangerie sans gluten\n4050 Av. du Parc-La Fontaine", blob),
    ).toBe(true);
    // Same span, whitespace collapsed the way a model often writes it.
    expect(
      quoteAppearsIn("Boulangerie sans gluten 4050 Av. du Parc-La Fontaine", blob),
    ).toBe(true);
  });

  it("accepts a quote containing a double quote", () => {
    // `"` is `\"` once stringified, so this failed for the same reason.
    const reviewed = { results: [{ snippet: 'Staff said it was "totally safe"' }] };
    expect(quoteAppearsIn('it was "totally safe"', reviewed)).toBe(true);
  });

  it("accepts the full-width angle brackets the fence itself introduced", () => {
    // `fenceUntrusted` rewrites runs of `<<`/`>>` to look-alikes so scraped text
    // cannot close the fence. The model quotes what it was SHOWN, which is then
    // absent from the source — our own sanitiser making the model look wrong.
    const crumbs = { results: [{ snippet: "Home >> Bakery >> Gluten free" }] };
    expect(quoteAppearsIn("Home ＜＜ Bakery", crumbs)).toBe(false);
    expect(quoteAppearsIn("Home ＞＞ Bakery", crumbs)).toBe(true);
  });

  it("still rejects a quote the model made up", () => {
    // The point of the guard, unchanged.
    expect(quoteAppearsIn("certified celiac-safe kitchen", blob)).toBe(false);
    expect(quoteAppearsIn("Parc Sans Gluten is dangerous", blob)).toBe(false);
  });

  it("will not let a quote be stitched across two unrelated fields", () => {
    // Leaves are matched separately rather than concatenated, so the tail of one
    // field plus the head of another is not a quote.
    const two = { results: [{ name: "Safe Bakery", category: "Dangerous fryer" }] };
    expect(quoteAppearsIn("Safe Bakery", two)).toBe(true);
    expect(quoteAppearsIn("Dangerous fryer", two)).toBe(true);
    expect(quoteAppearsIn("Safe Bakery Dangerous fryer", two)).toBe(false);
  });

  it("folds only formatting, never words", () => {
    expect(normalizeForQuoteMatch("  Sans   Gluten\n ")).toBe("sans gluten");
    // Curly punctuation a model routinely "tidies".
    expect(normalizeForQuoteMatch("it’s gluten‑free")).toBe(
      normalizeForQuoteMatch("it's gluten-free"),
    );
    // Word order is still load-bearing.
    expect(normalizeForQuoteMatch("gluten free")).not.toBe(
      normalizeForQuoteMatch("free gluten"),
    );
  });

  it("reaches strings at any depth, and treats an empty quote as fine", () => {
    // `extract.ts` already allows an empty quote paired with `unclear`.
    expect(quoteAppearsIn("", blob)).toBe(true);
    const nested = { place: { reviewTopics: ["gluten free, mentioned in 89 reviews"] } };
    expect(quoteAppearsIn("mentioned in 89 reviews", nested)).toBe(true);
  });
});

describe("the dropped-quote log line", () => {
  it("says WHAT was dropped, not just that something was", async () => {
    // Without the text, "the model made something up" and "the guard cannot
    // match its own encoding" look identical in the log — and for a long time
    // it was the second.
    const lines: string[] = [];
    const llm = new FakeLlmProvider({
      handler: () => ({
        places: [
          {
            name: "Test Cafe",
            evidence: [
              {
                requirementId: "celiac",
                claim: "invented",
                polarity: "supports",
                quote: "a certified celiac kitchen",
                confidence: 0.9,
              },
            ],
          },
        ],
      }),
    });

    const findings = await extractFindings(
      { results: [{ name: "Test Cafe", snippet: "just a cafe" }] },
      {
        source: "google_maps",
        sourceUrl: "https://maps.example/x",
        requirements: [],
        uiLocale: "en",
        searchLang,
        llm,
        signal: new AbortController().signal,
        log: async (_level, message) => {
          lines.push(message);
        },
      },
    );

    expect(findings[0]?.evidence).toHaveLength(0);
    expect(lines.join(" ")).toContain("a certified celiac kitchen");
  });
});
