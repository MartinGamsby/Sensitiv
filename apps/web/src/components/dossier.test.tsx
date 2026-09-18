import { describe, expect, it } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { DossierSchema, disclaimerFor } from "@sensitiv/shared";
import { Dossier } from "./dossier.tsx";
import {
  consensusFor,
  safeExternalHref,
  safeThumbnailSrc,
} from "./dossier-place-card.tsx";
import { renderIntl } from "../test-support/intl.tsx";

function makeDossier(overrides: Record<string, unknown> = {}) {
  return DossierSchema.parse({
    jobId: "job-1",
    status: "done",
    uiLocale: "en",
    searchLang: "fr",
    replays: [],
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

  it("attributes an excerpt to the source's own name, not to its adapter id", () => {
    const { container } = renderIntl(<Dossier dossier={makeDossier()} />);
    const attributions = Array.from(container.querySelectorAll("li p"))
      .map((p) => p.textContent ?? "")
      .filter((text) => text.includes("2024-05-01"));
    expect(attributions.length).toBeGreaterThan(0);
    expect(attributions[0]).toContain("Google Maps");
    expect(attributions[0]).not.toContain("google_maps");
  });

  it("renders an OpenStreetMap tag as a key/value chip, not as a spoken quote", () => {
    const dossier = makeDossier({ searchLang: "en" });
    dossier.places[0]!.evidence = [
      {
        requirementId: "celiac",
        claim: "Celiac-safe — OpenStreetMap records this venue as entirely dedicated to it",
        polarity: "supports",
        quote: "diet:gluten_free=only",
        source: "openstreetmap",
        sourceUrl: "https://www.openstreetmap.org/node/1",
        confidence: 0.95,
      },
    ];

    const { container } = renderIntl(<Dossier dossier={dossier} />);

    const chip = screen.getByTestId("tag-quote");
    expect(chip.textContent).toContain("OpenStreetMap tag");
    // Key and value survive verbatim — a reader has to be able to check them.
    expect(chip.querySelector("code")?.textContent).toBe("diet:gluten_free = only");
    // ...but not dressed up as something a person said.
    expect(container.querySelector("blockquote")).toBeNull();
    expect(container.textContent).not.toContain("“diet:gluten_free=only”");
    expect(
      screen.getByText(/OpenStreetMap records this venue as entirely dedicated/),
    ).toBeTruthy();
  });

  it("does not offer to translate a tag, which has no source language", () => {
    // A French search would normally put a translation line under every quote.
    const dossier = makeDossier({ searchLang: "fr" });
    dossier.places[0]!.evidence = [
      {
        requirementId: "access",
        claim: "Step-free entrance — OpenStreetMap records it as specifically provided for here",
        polarity: "supports",
        quote: "wheelchair=designated",
        source: "openstreetmap",
        sourceUrl: "https://www.openstreetmap.org/node/2",
        confidence: 0.95,
      },
    ];

    renderIntl(<Dossier dossier={dossier} />);

    expect(screen.queryAllByTestId("quote-translation")).toHaveLength(0);
  });

  it("links a stored replay to our own download route, never the third-party one", () => {
    const { container } = renderIntl(
      <Dossier
        dossier={makeDossier({
          replays: [
            {
              id: "replay-1",
              adapterId: "google_maps",
              status: "stored",
              findingCount: 3,
              sizeBytes: 1_234_567,
            },
          ],
        })}
      />,
    );

    const hrefs = Array.from(container.querySelectorAll("a")).map((a) =>
      a.getAttribute("href"),
    );
    expect(hrefs).toContain("/api/jobs/job-1/replays/replay-1");
  });

  it("renders no anchor for an expired link_only replay", () => {
    // `expiresAt` in the past means the presigned URL is dead — rendering it
    // as a live link would send the user to a failed download.
    const { container } = renderIntl(
      <Dossier
        dossier={makeDossier({
          replays: [
            {
              id: "replay-2",
              adapterId: "yelp",
              status: "link_only",
              url: "https://replay.example/expired",
              expiresAt: Date.now() - 60_000,
            },
          ],
        })}
      />,
    );

    const hrefs = Array.from(container.querySelectorAll("a")).map((a) =>
      a.getAttribute("href"),
    );
    expect(hrefs).not.toContain("https://replay.example/expired");
    expect(container.textContent).toContain("This link has expired.");
  });

  it("renders no anchor for a hostile-scheme URL on a link_only replay", () => {
    // The presigned URL is third-party output (the Solari gateway's
    // response) and `DossierReplaySchema.url` does not constrain the scheme,
    // so a compromised gateway answering `javascript:…` must not become a
    // click-to-run href — same gate `safeExternalHref` applies everywhere
    // else in the dossier.
    const { container } = renderIntl(
      <Dossier
        dossier={makeDossier({
          replays: [
            {
              id: "replay-3",
              adapterId: "store_locator",
              status: "link_only",
              url: "javascript:alert(document.domain)",
              expiresAt: Date.now() + 60_000,
            },
          ],
        })}
      />,
    );

    const hrefs = Array.from(container.querySelectorAll("a")).map((a) =>
      a.getAttribute("href"),
    );
    expect(hrefs.some((h) => /^javascript:/i.test(h ?? ""))).toBe(false);
  });

  it("keeps the 'no replay' note when the run recorded none at all", () => {
    const { container } = renderIntl(
      <Dossier dossier={makeDossier({ replays: [] })} />,
    );
    expect(container.querySelector("p.italic")).not.toBeNull();
  });
});

describe("<Dossier /> sample-data strip", () => {
  it("appears and names the fixture sources when sourceModes contains any 'fixture'", () => {
    const { container } = renderIntl(
      <Dossier
        dossier={makeDossier({
          sourceModes: { llm: "live", google_maps: "fixture", yelp: "live" },
        })}
      />,
    );
    expect(screen.getByText("This dossier contains sample data.")).toBeTruthy();
    expect(
      container.querySelector('[data-testid="sample-data-strip"]')
        ?.textContent,
    ).toContain("google_maps");
  });

  it("does not appear for an all-live dossier", () => {
    renderIntl(
      <Dossier
        dossier={makeDossier({
          sourceModes: { llm: "live", google_maps: "live" },
        })}
      />,
    );
    expect(
      screen.queryByText("This dossier contains sample data."),
    ).toBeNull();
  });

  it("does not appear when sourceModes is empty (pre-existing run, not recorded)", () => {
    renderIntl(<Dossier dossier={makeDossier({ sourceModes: {} })} />);
    expect(
      screen.queryByText("This dossier contains sample data."),
    ).toBeNull();
  });

  // A `dining` job always resolves the v1.1 stubs, so if `"stub"` counted as
  // sample data this strip would be on for every run ever, live ones included.
  it("does not appear for a live run whose only non-live sources are stubs", () => {
    const { container } = renderIntl(
      <Dossier
        dossier={makeDossier({
          sourceModes: {
            llm: "live",
            google_maps: "live",
            yelp: "stub",
            find_me_gluten_free: "stub",
          },
        })}
      />,
    );
    expect(
      screen.queryByText("This dossier contains sample data."),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="sample-data-strip"]'),
    ).toBeNull();
  });
});

describe("<Dossier /> not-searched note", () => {
  it("names the stub sources, and only those", () => {
    const { container } = renderIntl(
      <Dossier
        dossier={makeDossier({
          sourceModes: {
            llm: "live",
            google_maps: "fixture",
            yelp: "stub",
            store_locator: "stub",
          },
        })}
      />,
    );
    const note = container.querySelector('[data-testid="not-searched-note"]');
    expect(note?.textContent).toContain("yelp");
    expect(note?.textContent).toContain("store_locator");
    expect(note?.textContent).not.toContain("google_maps");
    expect(note?.textContent).not.toContain("llm");
  });

  it("is absent when nothing was stubbed", () => {
    const { container } = renderIntl(
      <Dossier
        dossier={makeDossier({
          sourceModes: { llm: "live", google_maps: "live" },
        })}
      />,
    );
    expect(
      container.querySelector('[data-testid="not-searched-note"]'),
    ).toBeNull();
  });
});

describe("safeThumbnailSrc — the render-side gate on a scraped photo", () => {
  it("accepts a Google user-content photo", () => {
    const url = "https://lh3.googleusercontent.com/gps-cs-s/abc=w400-h300-k-no";
    expect(safeThumbnailSrc(url)).toBe(url);
  });

  it("rejects any other origin, however plausible", () => {
    // Stricter than `safeExternalHref` on purpose: that guards a link the user
    // chooses to follow; this becomes an `<img src>` the browser fetches on its
    // own, with no click in between.
    expect(safeThumbnailSrc("https://evil.example/pixel.gif")).toBeUndefined();
    expect(safeThumbnailSrc("https://googleusercontent.com.evil.example/x")).toBeUndefined();
    expect(safeThumbnailSrc("http://lh3.googleusercontent.com/x")).toBeUndefined();
    expect(safeThumbnailSrc("javascript:alert(1)")).toBeUndefined();
    expect(safeThumbnailSrc("data:image/svg+xml,<svg onload=alert(1)>")).toBeUndefined();
  });

  it("rejects nothing and garbage", () => {
    expect(safeThumbnailSrc(undefined)).toBeUndefined();
    expect(safeThumbnailSrc("not a url")).toBeUndefined();
  });
});

describe("place thumbnails in the dossier", () => {
  it("renders the photo without giving it a redundant accessible name", () => {
    // Decorative: the name, address and category sit right beside it, so a
    // screen reader gains nothing from a description of a stock storefront.
    const dossier = makeDossier();
    dossier.places[0]!.place.thumbnailUrl =
      "https://lh3.googleusercontent.com/gps-cs-s/abc=w400-h300-k-no";

    const { container } = renderIntl(<Dossier dossier={dossier} />);

    const img = container.querySelector("img");
    expect(img?.getAttribute("src")).toContain("googleusercontent.com");
    expect(img?.getAttribute("alt")).toBe("");
    // Keeps the dossier's own URL out of a third-party request.
    expect(img?.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(img?.getAttribute("loading")).toBe("lazy");
  });

  it("renders no image at all when a place has no photo", () => {
    const { container } = renderIntl(<Dossier dossier={makeDossier()} />);
    expect(container.querySelector("img")).toBeNull();
  });

  it("renders no image when the stored URL is not one we would have written", () => {
    // Covers rows written before the capture-side check existed, and anything
    // that reached the column by another route.
    const dossier = makeDossier();
    dossier.places[0]!.place.thumbnailUrl = "https://evil.example/pixel.gif";

    const { container } = renderIntl(<Dossier dossier={dossier} />);

    expect(container.querySelector("img")).toBeNull();
  });
});

describe("continuous scores render readably", () => {
  it("shows one decimal for a fractional score", () => {
    // Scores stopped being integers when confidence and distance started
    // feeding them.
    const dossier = makeDossier();
    dossier.places[0]!.score = 5.7000000000000002;

    renderIntl(<Dossier dossier={dossier} />);

    expect(screen.getByText(/\+5\.7/)).toBeTruthy();
  });

  it("still shows a whole number as a whole number", () => {
    const dossier = makeDossier();
    dossier.places[0]!.score = 6;

    renderIntl(<Dossier dossier={dossier} />);

    expect(screen.getByText(/\+6\b/)).toBeTruthy();
  });

  it("keeps the sign on a negative score", () => {
    const dossier = makeDossier();
    dossier.places[0]!.score = -4.5;

    renderIntl(<Dossier dossier={dossier} />);

    expect(screen.getByText(/-4\.5/)).toBeTruthy();
  });
});

describe("dossier ordering control", () => {
  it("offers Recommended by default and reorders on change", () => {
    const dossier = makeDossier();
    dossier.searchCenter = { lat: 45.582, lng: -73.5829 };
    dossier.places = [
      {
        ...dossier.places[0]!,
        place: { name: "Far High", canonicalKey: "far", lat: 45.5167, lng: -73.5739 },
        score: 9,
      },
      {
        ...dossier.places[0]!,
        place: { name: "Near Low", canonicalKey: "near", lat: 45.5957, lng: -73.5709 },
        score: 1,
      },
    ];

    const { container } = renderIntl(<Dossier dossier={dossier} />);

    const headings = () =>
      Array.from(container.querySelectorAll("h3")).map((h) => h.textContent);
    expect(headings()).toEqual(["Far High", "Near Low"]);

    fireEvent.change(screen.getByLabelText(/sort/i), { target: { value: "closest" } });
    expect(headings()).toEqual(["Near Low", "Far High"]);
  });

  it("hides the distance option when the run recorded no centre", () => {
    // Every run written before the centre was stored.
    const dossier = makeDossier();
    dossier.searchCenter = undefined;

    renderIntl(<Dossier dossier={dossier} />);

    expect(screen.queryByRole("option", { name: /closest/i })).toBeNull();
  });
});
