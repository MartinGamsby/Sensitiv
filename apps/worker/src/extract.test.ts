import { describe, expect, it } from "vitest";
import { FakeLlmProvider } from "@sensitiv/shared/llm";
import { extractFindings, ExtractionSchema } from "./extract.ts";

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
