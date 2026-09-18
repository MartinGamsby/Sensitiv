import { describe, expect, it } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { DossierSchema, disclaimerFor } from "@sensitiv/shared";
import { Dossier } from "./dossier.tsx";
import { consensusFor, safeExternalHref } from "./dossier-place-card.tsx";
import { placeHue, placeInitials } from "./place-photo.tsx";
import { matchHue } from "./ui/match-pill.tsx";
import { renderIntl } from "../test-support/intl.tsx";
import { routerCalls, setSearchParams } from "../test-support/router.ts";
import { LocationSchema } from "@sensitiv/shared";
import type { RunBriefData } from "@/lib/run-brief.ts";

const CELIAC_REQUIREMENT = {
  id: "celiac",
  catalogId: "celiac",
  label: "Celiac",
  intentIds: ["dining"],
  must: ["dedicated gluten-free kitchen"],
  nice: [],
  weight: 3,
  satisfiedBy: [],
};

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

/** The `canonicalKey` of the fixture's only place — its address in a URL. */
const CAFE_KEY = "cafe-test|123-rue-saint-denis";

/**
 * Render the dossier with one place's detail already open.
 *
 * Opening a place is a URL change, not a click on a stateful widget: the
 * card is a link to `?place=<canonicalKey>` and the overlay renders from
 * whatever that parameter says. So a test opens one by setting the parameter
 * before rendering, which is also exactly what a pasted link does.
 */
function renderWithPlaceOpen(
  dossier: ReturnType<typeof makeDossier>,
  key: string = CAFE_KEY,
) {
  setSearchParams(`place=${encodeURIComponent(key)}`);
  return renderIntl(<Dossier dossier={dossier} />);
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
    // On the card itself, with nothing open: a disagreement about a kitchen
    // is the one fact a reader may not have to click for.
    expect(screen.getByText("Sources conflict")).toBeTruthy();
    expect(
      screen.getByText(
        "This is research assistance, not medical, legal, or housing advice.",
      ),
    ).toBeTruthy();
  });

  it("shows a translation line for a French quote under an English UI", () => {
    renderWithPlaceOpen(makeDossier());
    const lines = screen.getAllByTestId("quote-translation");
    expect(lines.length).toBeGreaterThan(0);
    expect(lines[0]!.textContent).toContain("Translation");
  });

  it("omits the translation line when the search language matches the UI locale", () => {
    renderIntl(<Dossier dossier={makeDossier({ searchLang: "en" })} />);
    expect(screen.queryAllByTestId("quote-translation")).toHaveLength(0);
  });

  it("tints the match pill by how good the match is", () => {
    const dossier = makeDossier({
      requirements: [CELIAC_REQUIREMENT],
      searchCenter: undefined,
    });
    dossier.places[0]!.score = 7.5; // the ceiling -> 100%

    const { container } = renderIntl(<Dossier dossier={dossier} />);

    const pill = container.querySelector('[data-testid="match-pill"]');
    expect(pill?.textContent).toContain("100%");
    // Green. The hue is the only dynamic part; `globals.css` turns it into a
    // background and a foreground per theme.
    expect(pill?.getAttribute("style")).toContain("--match-h: 120");
  });

  it("leaves a raw score untinted, having no ceiling to be a fraction of", () => {
    const { container } = renderIntl(<Dossier dossier={makeDossier({ requirements: [] })} />);

    expect(container.querySelector('[data-testid="match-pill"]')).toBeNull();
    expect(screen.getByText("Score +3")).toBeTruthy();
  });

  it("states the score as a percentage of what this run could have scored", () => {
    // celiac weight 3 -> ceiling 3 * 2.5 = 7.5 (no centre, so no proximity term).
    const dossier = makeDossier({
      requirements: [CELIAC_REQUIREMENT],
      searchCenter: undefined,
    });
    dossier.places[0]!.score = 3.75;

    renderIntl(<Dossier dossier={dossier} />);

    expect(screen.getByRole("link", { name: /Match 50%/ })).toBeTruthy();
    expect(screen.queryByText(/Score +3/)).toBeNull();
  });

  it("falls back to the raw score when the run researched nothing to divide by", () => {
    renderIntl(<Dossier dossier={makeDossier({ requirements: [] })} />);
    expect(screen.getByText("Score +3")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Match/ })).toBeNull();
  });

  it("opens a breakdown that names each rule, its weight and its contribution", () => {
    const dossier = makeDossier({
      requirements: [CELIAC_REQUIREMENT],
      searchCenter: undefined,
    });
    dossier.places[0]!.score = 5.7;
    dossier.places[0]!.breakdown = [
      {
        requirementId: "celiac",
        rule: "explicit",
        delta: 5.7,
        weight: 3,
        reason: "a source explicitly marks this requirement",
      },
    ];

    renderWithPlaceOpen(dossier);

    expect(screen.getByText("How this score was worked out")).toBeTruthy();
    expect(screen.getByText("+5.7")).toBeTruthy();
    expect(screen.getByText(/counts ×3/)).toBeTruthy();
    expect(
      screen.getByText("A source explicitly marks this requirement"),
    ).toBeTruthy();
    // The ceiling is stated too — a number is only readable next to its top.
    expect(screen.getByText(/out of a possible 7.5/)).toBeTruthy();
  });

  it("says so when a place was scored before breakdowns were recorded", () => {
    const dossier = makeDossier({
      requirements: [CELIAC_REQUIREMENT],
      searchCenter: undefined,
    });
    dossier.places[0]!.breakdown = [];

    renderWithPlaceOpen(dossier);

    expect(
      screen.getByText("This run recorded no breakdown for its scores."),
    ).toBeTruthy();
  });

  it("links each source chip to the listing it is citing", () => {
    const { container } = renderWithPlaceOpen(makeDossier());

    const chip = container.querySelector('a[href="https://maps.example/x"]');
    expect(chip).not.toBeNull();
    expect(chip?.textContent).toContain("Google Maps");
    expect(chip?.textContent).toContain("Rating 4.5");
    expect(chip?.textContent).not.toContain("google_maps");
    expect(chip?.getAttribute("rel")).toContain("noopener");
  });

  it("renders a source chip as plain text when its URL is not a safe link", () => {
    const dossier = makeDossier();
    dossier.places[0]!.sources = [
      // LLM output off a scraped page: never rendered as an href.
      { source: "google_maps", sourceUrl: "javascript:alert(1)", rating: 4.5 },
    ];

    const { container } = renderWithPlaceOpen(dossier);

    expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(screen.getByText(/Google Maps · Rating 4.5/)).toBeTruthy();
  });

  it("calls the place's own link a website, not \"Links\"", () => {
    const dossier = makeDossier();
    dossier.places[0]!.place.url = "https://cafe-test.example/";

    renderWithPlaceOpen(dossier);

    const link = screen.getByRole("link", { name: /website/i });
    expect(link.getAttribute("href")).toBe("https://cafe-test.example/");
    expect(screen.queryByRole("link", { name: /^links$/i })).toBeNull();
  });

  it("attributes an excerpt to the source's own name, not to its adapter id", () => {
    const { container } = renderWithPlaceOpen(makeDossier());
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

    const { container } = renderWithPlaceOpen(dossier);

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

describe("<Dossier /> and sources that never ran", () => {
  it("says nothing at all about a source the run did not search", () => {
    // There used to be a note here reading "Not searched: yelp,
    // find_me_gluten_free, store_locator. These sources are not implemented
    // yet, so they ran but contributed nothing." Every clause was a problem:
    // they no longer run (the no-op adapters are deleted), two of them are
    // refused on policy rather than pending, and a source that contributed
    // nothing is not worth a line in a dossier. Old runs still carry `"stub"`
    // rows; they get silence, not a wrong explanation.
    const { container } = renderIntl(
      <Dossier
        dossier={makeDossier({
          sourceModes: {
            llm: "live",
            google_maps: "live",
            yelp: "stub",
            store_locator: "stub",
          },
        })}
      />,
    );

    expect(container.textContent).not.toContain("Not searched");
    expect(container.textContent).not.toContain("yelp");
    expect(container.textContent).not.toContain("store_locator");
  });

  it("still does not mistake an old stub row for sample data", () => {
    // `"stub"` means the source did not run; `"fixture"` means canned data
    // stood in for a live result. Folding the first into the second would
    // put the sample-data warning on every dossier written before the no-op
    // adapters were removed.
    const { container } = renderIntl(
      <Dossier
        dossier={makeDossier({
          sourceModes: { llm: "live", google_maps: "live", yelp: "stub" },
        })}
      />,
    );

    expect(
      container.querySelector('[data-testid="sample-data-strip"]'),
    ).toBeNull();
  });
});

describe("matchHue — the match pill's red-to-green ramp", () => {
  it("runs red at 0 through orange and yellow to green at 100", () => {
    expect(matchHue(0)).toBe(0); // red
    expect(matchHue(25)).toBe(30); // orange
    expect(matchHue(50)).toBe(60); // yellow
    expect(matchHue(100)).toBe(120); // green
  });

  it("clamps, because a score can come out below zero", () => {
    // `scorePercent` divides a SIGNED score by a run-wide ceiling, so a place
    // that contradicts everything it was asked about lands under 0 — and a
    // negative hue is not a colour.
    expect(matchHue(-40)).toBe(0);
    expect(matchHue(140)).toBe(120);
  });
});

describe("placeInitials", () => {
  it("takes the initial of each of the first two words", () => {
    expect(placeInitials("Boulangerie Le Marquis")).toBe("BL");
    expect(placeInitials("Panella")).toBe("P");
  });

  it("skips the punctuation a French name starts a word with", () => {
    // `name.slice(0, 2)` would render "L'" here and "Le" for half the list —
    // the same two letters on card after card, which is no cue at all.
    expect(placeInitials("L'artisan délices sans gluten")).toBe("LD");
    expect(placeInitials("Crêperie du Marché")).toBe("CD");
  });

  it("always produces something rather than an empty square", () => {
    expect(placeInitials("東京")).toBe("東");
    expect(placeInitials("   ")).toBe("?");
  });
});

describe("placeHue", () => {
  it("gives a place the same colour every time it is opened", () => {
    expect(placeHue("Panella")).toBe(placeHue("Panella"));
    expect(placeHue("Panella")).toBeGreaterThanOrEqual(0);
    expect(placeHue("Panella")).toBeLessThan(360);
  });

  it("separates names that differ by one character", () => {
    expect(placeHue("Ottavio")).not.toBe(placeHue("Ottavia"));
  });
});

describe("place photos in the dossier", () => {
  it("loads a photo through our own origin, never the host it came from", () => {
    // The row's URL is third-party and is now fetched SERVER-side, so the
    // page's image sources stay entirely on our own origin — which is
    // narrower than the old googleusercontent hotlink, not wider.
    const dossier = makeDossier();
    dossier.places[0]!.place.thumbnailUrl =
      "https://lh3.googleusercontent.com/gps-cs-s/abc=w400-h300-k-no";

    const { container } = renderIntl(<Dossier dossier={dossier} />);

    const img = container.querySelector("img");
    expect(img?.getAttribute("src")).toBe(
      "/api/jobs/job-1/places/cafe-test%7C123-rue-saint-denis/photo",
    );
    expect(img?.getAttribute("src")).not.toContain("googleusercontent");
    // Decorative: the name, address and category sit right beside it.
    expect(img?.getAttribute("alt")).toBe("");
    expect(img?.getAttribute("loading")).toBe("lazy");
  });

  it("gives a place with no photo a tile rather than a gap", () => {
    // A missing image element made the card's title start at a different x
    // than its neighbours', and a list of sixteen read as ragged.
    const { container } = renderIntl(<Dossier dossier={makeDossier()} />);

    expect(container.querySelector("img")).toBeNull();
    const tile = container.querySelector('[data-testid="place-initials"]');
    expect(tile?.textContent).toBe("CT");
    expect(tile?.getAttribute("aria-hidden")).toBe("true");
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

describe("a place card is a shortlist entry, and the detail is a URL", () => {
  it("shows only who/where/how well it matched, and links to the rest", () => {
    const dossier = makeDossier({
      requirements: [CELIAC_REQUIREMENT],
      searchCenter: undefined,
    });
    dossier.places[0]!.score = 3.75;

    renderIntl(<Dossier dossier={dossier} />);

    // On the card: the name, the address, the category, the match.
    expect(screen.getByTestId("place-name").textContent).toBe("Café Test");
    expect(screen.getByText("123 Rue Saint-Denis")).toBeTruthy();
    expect(screen.getByText("cafe")).toBeTruthy();

    // The whole card is one link to this place's own address, so "look at
    // this one" is something a reader can send someone.
    const card = screen.getByRole("link", { name: /Café Test/ });
    // Locale-prefixed by `@/i18n/navigation`'s `Link`, which is why
    // `placeDetailPath` must NOT prefix it too.
    expect(card.getAttribute("href")).toBe(
      `/en/jobs/job-1?place=${encodeURIComponent(CAFE_KEY)}`,
    );
    expect(card.textContent).toContain("Match 50%");

    // Not on the card, and not in the DOM either: unlike the old disclosure,
    // nothing renders the evidence until the URL asks for it.
    expect(screen.queryByTestId("place-modal")).toBeNull();
    expect(screen.queryByText(/cuisine sans gluten/)).toBeNull();
  });

  it("opens that place when the URL names it, over a dossier that stays put", () => {
    const { container } = renderWithPlaceOpen(makeDossier());

    expect(screen.getByTestId("place-modal")).toBeTruthy();
    expect(screen.getByTestId("place-detail-name").textContent).toBe("Café Test");
    expect(screen.getByText("Match by requirement")).toBeTruthy();
    expect(screen.getByText("Red flags")).toBeTruthy();
    // The list is still mounted underneath — closing returns the reader to
    // the scroll position and sort they left, with no refetch.
    expect(
      container.querySelectorAll('[data-testid="dossier-grid"] article').length,
    ).toBe(1);
  });

  it("carries the disclaimer, which the overlay is covering", () => {
    renderWithPlaceOpen(makeDossier());
    // Once in the dossier behind, once inside the modal. No view that
    // presents research as an answer goes without it.
    expect(
      screen.getAllByText(
        "This is research assistance, not medical, legal, or housing advice.",
      ).length,
    ).toBe(2);
  });

  it("renders nothing for a key that names no place in this run", () => {
    // A link that outlived the run it pointed into. Dropping the reader on
    // the list they asked for beats an error about a key they never typed.
    setSearchParams("place=somewhere-that-was-deleted");
    renderIntl(<Dossier dossier={makeDossier()} />);

    expect(screen.queryByTestId("place-modal")).toBeNull();
    expect(screen.getByTestId("place-name").textContent).toBe("Café Test");
  });

  it("closes by going back, so the URL and the overlay cannot disagree", () => {
    renderWithPlaceOpen(makeDossier());

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    // `router.back()`, not local state: the overlay IS the URL, so closing
    // has to be a history move or the address bar would start lying.
    expect(routerCalls).toEqual([{ method: "back" }]);
  });

  it("closes on Escape", () => {
    renderWithPlaceOpen(makeDossier());

    fireEvent.keyDown(document, { key: "Escape" });

    expect(routerCalls).toEqual([{ method: "back" }]);
  });

  it("ranks by the recommended order, not by the reader's sort choice", () => {
    // The rank is in a URL someone can send. If it followed the sender's
    // sort control, the link would say something different to whoever opens
    // it than it said to the person who copied it.
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

    renderWithPlaceOpen(dossier, "near");
    // "Near Low" is second by score, and stays second in the overlay even
    // after the list is re-sorted to put it first.
    expect(screen.getByTestId("place-modal").textContent).toContain("2");

    fireEvent.change(screen.getByLabelText(/sort/i), {
      target: { value: "closest" },
    });
    expect(screen.getByTestId("place-modal").textContent).toContain("2");
  });
});

describe("a shared place URL carries the question, not just the answer", () => {
  const BRIEF: RunBriefData = {
    requestText: "italian",
    location: LocationSchema.parse({ query: "Rosemont, Montreal", radiusKm: 5 }),
    requirements: [CELIAC_REQUIREMENT],
    searchLang: "fr",
    createdAt: Date.now(),
  };

  it("names the run inside the overlay", () => {
    // `?place=` is the URL most likely to reach someone who never saw the
    // dossier. Without this they get a restaurant and a match percentage
    // with no idea what was asked or which requirements were checked.
    setSearchParams(`place=${encodeURIComponent(CAFE_KEY)}`);
    renderIntl(<Dossier dossier={makeDossier()} brief={BRIEF} />);

    const line = screen.getByTestId("run-brief-line");
    expect(line.textContent).toContain("italian");
    expect(line.textContent).toContain("Celiac");
    expect(line.textContent).toContain("Rosemont, Montreal");
  });

  it("still opens without one, for a run whose row could not be read", () => {
    setSearchParams(`place=${encodeURIComponent(CAFE_KEY)}`);
    renderIntl(<Dossier dossier={makeDossier()} />);

    expect(screen.getByTestId("place-modal")).toBeTruthy();
    expect(screen.queryByTestId("run-brief-line")).toBeNull();
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
      Array.from(container.querySelectorAll('[data-testid="place-name"]')).map(
        (h) => h.textContent,
      );
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
