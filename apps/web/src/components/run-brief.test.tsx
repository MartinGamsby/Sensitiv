import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { LocationSchema } from "@sensitiv/shared";
import { RunBrief, RunBriefLine, requirementLabel } from "./run-brief.tsx";
import { runHeadline, type RunBriefData } from "@/lib/run-brief.ts";
import { languageName } from "@/lib/language-name.ts";
import { renderIntl } from "../test-support/intl.tsx";

const CELIAC = {
  id: "celiac",
  catalogId: "celiac",
  label: "Coeliac / gluten-free",
  intentIds: ["dining"],
  must: [],
  nice: [],
  weight: 3,
  satisfiedBy: [],
};

function makeBrief(overrides: Partial<RunBriefData> = {}): RunBriefData {
  return {
    requestText: "italian",
    location: LocationSchema.parse({
      query: "Rosemont–La Petite-Patrie, Montreal, Quebec",
      city: "Montreal",
      region: "Quebec",
      country: "ca",
      radiusKm: 5,
    }),
    requirements: [CELIAC],
    searchLang: "en",
    createdAt: new Date("2026-09-17T23:15:00.000Z").getTime(),
    ...overrides,
  };
}

describe("runHeadline", () => {
  it("is what the user typed", () => {
    expect(runHeadline(makeBrief())).toBe("italian");
  });

  it("falls back to the place when the run was chips only", () => {
    // Five requirement chips and no free text is a complete question
    // ("anywhere celiac-safe near me"), not a broken run, so it gets a real
    // heading rather than a placeholder.
    expect(runHeadline(makeBrief({ requestText: "   " }))).toBe(
      "Rosemont–La Petite-Patrie, Montreal, Quebec",
    );
  });
});

describe("requirementLabel", () => {
  it("prefers the catalog, so the label follows the READER's locale", () => {
    // The stored label was written in whatever locale the run was created
    // in. A French reader opening an English-created run should still see
    // French.
    expect(requirementLabel(CELIAC, "fr")).toBe("Maladie cœliaque");
    expect(requirementLabel(CELIAC, "en")).not.toBe("Maladie cœliaque");
  });

  it("falls back to the stored label for a requirement the catalog invented", () => {
    // The planner mints these per run; the catalog has never heard of them.
    expect(
      requirementLabel(
        { ...CELIAC, id: "custom_mexican", catalogId: undefined, label: "Mexican" },
        "en",
      ),
    ).toBe("Mexican");
  });
});

describe("languageName", () => {
  it("names the language in the reader's locale", () => {
    expect(languageName("en", "fr")).toBe("anglais");
    expect(languageName("fr", "en")).toBe("French");
  });

  it("returns the code unchanged when it cannot be parsed", () => {
    // `jobs.search_lang` is a free-text column, and a run is not worth
    // breaking over its label.
    expect(languageName("not a language tag", "en")).toBe("not a language tag");
    expect(languageName("", "en")).toBe("");
  });
});

describe("<RunBrief />", () => {
  it("says what was asked, not just what was found", () => {
    // The whole point: `/jobs/<uuid>` used to read "Research run" over a
    // list of restaurants, with nothing about the question.
    renderIntl(<RunBrief brief={makeBrief()} />);

    expect(screen.getByRole("heading", { name: "italian" })).toBeTruthy();
    expect(screen.getByTestId("requirement-badge").textContent).toContain(
      "Celiac",
    );
    expect(
      screen.getByText("Rosemont–La Petite-Patrie, Montreal, Quebec"),
    ).toBeTruthy();
    expect(screen.getByText("within 5 km")).toBeTruthy();
    expect(screen.getByText("searched in English")).toBeTruthy();
  });

  it("answers 'around where?' with the pin the user dropped", () => {
    const brief = makeBrief({
      location: LocationSchema.parse({
        query: "Montreal",
        lat: 45.5576,
        lng: -73.5804,
        pinned: true,
        radiusKm: 2,
      }),
    });

    renderIntl(<RunBrief brief={brief} />);

    expect(screen.getByTestId("run-brief-centre").textContent).toContain(
      "pinned at 45.5576, -73.5804",
    );
  });

  it("otherwise reports the centre the run actually resolved", () => {
    // A postal code is re-resolved by the Maps hop, so the resolved centre
    // can be the only honest answer to "where did it look?".
    const brief = makeBrief({ searchCenter: { lat: 45.5233, lng: -73.5858 } });

    renderIntl(<RunBrief brief={brief} />);

    expect(screen.getByTestId("run-brief-centre").textContent).toContain(
      "searched around 45.5233, -73.5858",
    );
  });

  it("says nothing about a centre it never had", () => {
    // Rather than implying the text was searched verbatim.
    renderIntl(<RunBrief brief={makeBrief()} />);
    expect(screen.queryByTestId("run-brief-centre")).toBeNull();
  });
});

describe("<RunBriefLine />", () => {
  it("names the run for a reader who has never seen its dossier", () => {
    // This is what a shared place-detail URL opens with.
    renderIntl(<RunBriefLine brief={makeBrief()} />);

    const line = screen.getByTestId("run-brief-line");
    expect(line.textContent).toContain("italian");
    expect(line.textContent).toContain("Celiac");
    expect(line.textContent).toContain("Rosemont–La Petite-Patrie");
  });
});
