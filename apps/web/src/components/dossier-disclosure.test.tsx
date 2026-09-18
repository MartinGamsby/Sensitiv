import { describe, expect, it } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { DossierSchema, disclaimerFor } from "@sensitiv/shared";
import { Dossier } from "./dossier.tsx";
import { humanizeRequirementId } from "./dossier-place-card.tsx";
import { renderIntl } from "../test-support/intl.tsx";

/**
 * The progressive-disclosure rules the dossier redesign introduced. Each of
 * these is a promise about what stays reachable when a section is folded —
 * collapsing is a layout decision and must never drop information.
 */

function evidence(requirementId: string, n: number) {
  return Array.from({ length: n }, (_, i) => ({
    requirementId,
    claim: `claim ${i}`,
    polarity: "supports" as const,
    quote: `quote ${i}`,
    source: `source-${i}`,
    sourceUrl: `https://source-${i}.example/r`,
    confidence: 0.5,
  }));
}

function makeDossier(overrides: Record<string, unknown> = {}) {
  return DossierSchema.parse({
    jobId: "job-1",
    status: "done",
    uiLocale: "en",
    searchLang: "en",
    replays: [],
    disclaimer: disclaimerFor("en"),
    places: [
      {
        place: { name: "Café Test", canonicalKey: "cafe-test" },
        sources: [],
        evidence: evidence("celiac", 3),
        score: 3,
        conflicted: false,
      },
    ],
    ...overrides,
  });
}

describe("humanizeRequirementId", () => {
  it("turns a planner-minted id into a readable label", () => {
    // The planner mints these per run; the raw id used to render as a heading.
    expect(humanizeRequirementId("custom_mexican_restaurant")).toBe(
      "Mexican restaurant",
    );
    expect(humanizeRequirementId("late-night_delivery")).toBe(
      "Late night delivery",
    );
  });

  it("returns the id unchanged when there is nothing left to show", () => {
    expect(humanizeRequirementId("custom_")).toBe("custom_");
    expect(humanizeRequirementId("celiac")).toBe("Celiac");
  });
});

describe("<Dossier /> progressive disclosure", () => {
  it("shows the first excerpt and folds the rest behind a trigger", () => {
    renderIntl(<Dossier dossier={makeDossier()} />);

    // Two folds now, nested: the card itself, and the corroborating excerpts
    // inside it. Opening the card is what a reader does to get to the
    // evidence, so the test does it too.
    fireEvent.click(screen.getAllByRole("button", { expanded: false })[0]!);

    // Lead excerpt is visible once the card is open — no second click.
    expect(screen.getByText(/quote 0/)).toBeTruthy();

    const trigger = screen.getByRole("button", { name: /Show 2 more excerpts/ });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
  });

  it("keeps folded excerpts in the DOM so nothing is lost to a closed panel", () => {
    // Collapsed means `hidden`, not unmounted — in-page search and the
    // existing replay/testid assertions both depend on this.
    const { container } = renderIntl(<Dossier dossier={makeDossier()} />);
    expect(container.textContent).toContain("quote 2");
  });

  it("renders the disclaimer outside every collapsible section", () => {
    const { container } = renderIntl(<Dossier dossier={makeDossier()} />);
    const note = screen.getByText(
      "This is research assistance, not medical, legal, or housing advice.",
    );
    // Walk up from the disclaimer: no ancestor may be a collapsed region.
    for (let el = note.parentElement; el && el !== container; el = el.parentElement) {
      expect(el.hasAttribute("hidden")).toBe(false);
    }
  });

  it("puts replays behind the run-details trigger, collapsed by default", () => {
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

    const trigger = screen.getByRole("button", { name: /Run details/ });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    // The link stays in the DOM while collapsed — `hidden` takes it out of the
    // accessibility tree (which is what we want) but never unmounts it, so the
    // existing `querySelectorAll("a")` replay assertions keep working.
    const hrefs = Array.from(container.querySelectorAll("a")).map((a) =>
      a.getAttribute("href"),
    );
    expect(hrefs).toContain("/api/jobs/job-1/replays/replay-1");
  });
});
