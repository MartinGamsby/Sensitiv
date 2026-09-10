import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { DossierSchema, disclaimerFor } from "@sensitiv/shared";
import { Dossier } from "./dossier.tsx";
import { consensusFor, safeExternalHref } from "./dossier-place-card.tsx";
import { renderIntl } from "../test-support/intl.tsx";

function makeDossier(overrides: Record<string, unknown> = {}) {
  return DossierSchema.parse({
    jobId: "job-1",
    status: "done",
    uiLocale: "en",
    searchLang: "fr",
    replayUrls: [],
    disclaimer: disclaimerFor("en"),
    places: [
      {
        place: {
          name: "Café Test",
          address: "123 Rue Saint-Denis",
          category: "cafe",
          canonicalKey: "cafe-test|123-rue-saint-denis",
        },
        sources: [
          {
            source: "google_maps",
            sourceUrl: "https://maps.example/x",
            rating: 4.5,
            reviewCount: 120,
          },
        ],
        evidence: [
          {
            requirementId: "celiac",
            claim: "Staff confirmed a dedicated gluten-free kitchen",
            polarity: "supports",
            quote: "cuisine sans gluten entièrement dédiée",
            source: "google_maps",
            sourceUrl: "https://maps.example/x/r1",
            date: "2024-05-01",
            confidence: 0.9,
          },
          {
            requirementId: "celiac",
            claim: "A reviewer reported getting glutened",
            polarity: "contradicts",
            quote: "je suis tombé malade après le repas",
            source: "yelp",
            sourceUrl: "https://yelp.example/x/r2",
            confidence: 0.6,
          },
        ],
        score: 3,
        conflicted: true,
      },
    ],
    ...overrides,
  });
}

describe("consensusFor", () => {
  it("is conflicted when the same requirement has both supports and contradicts", () => {
    expect(
      consensusFor([
        { polarity: "supports", source: "a" },
        { polarity: "contradicts", source: "b" },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ] as any),
    ).toBe("conflicted");
  });

  it("is single when only one source spoke to it", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(consensusFor([{ polarity: "supports", source: "a" }] as any)).toBe(
      "single",
    );
  });

  it("is agreed when multiple sources agree", () => {
    expect(
      consensusFor([
        { polarity: "supports", source: "a" },
        { polarity: "supports", source: "b" },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ] as any),
    ).toBe("agreed");
  });
});

describe("safeExternalHref", () => {
  it("keeps absolute http(s) URLs", () => {
    expect(safeExternalHref("https://maps.example/x")).toBe(
      "https://maps.example/x",
    );
    expect(safeExternalHref("http://maps.example/x")).toBe(
      "http://maps.example/x",
    );
  });

  it("drops every other scheme and anything unparseable", () => {
    // `place.url` / `sourceUrl` are LLM output over attacker-influenceable
    // scraped text; the schemas do not constrain the scheme.
    for (const hostile of [
      "javascript:alert(document.domain)",
      "JaVaScRiPt:alert(1)",
      "  javascript:alert(1)",
      "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
      "blob:https://evil.example/abc",
      "vbscript:msgbox(1)",
      "file:///etc/passwd",
      "/relative/path",
      "not a url at all",
      "",
    ]) {
      expect(safeExternalHref(hostile)).toBeUndefined();
    }
  });
});

describe("<Dossier />", () => {
  it("renders a conflicted place amber, never hidden, with the disclaimer", () => {
    const { container } = renderIntl(<Dossier dossier={makeDossier()} />);

    expect(screen.getByText("Café Test")).toBeTruthy();
    expect(container.querySelector('[data-conflicted="true"]')).not.toBeNull();
    expect(screen.getByText("Sources conflict")).toBeTruthy();
    expect(
      screen.getByText(
        "This is research assistance, not medical, legal, or housing advice.",
      ),
    ).toBeTruthy();
  });

  it("shows a translation line for a French quote under an English UI", () => {
    renderIntl(<Dossier dossier={makeDossier()} />);
    const lines = screen.getAllByTestId("quote-translation");
    expect(lines.length).toBeGreaterThan(0);
    expect(lines[0]!.textContent).toContain("Translation");
  });

  it("omits the translation line when the search language matches the UI locale", () => {
    renderIntl(<Dossier dossier={makeDossier({ searchLang: "en" })} />);
    expect(screen.queryAllByTestId("quote-translation")).toHaveLength(0);
  });
});
