import { describe, expect, it } from "vitest";
import scenario from "../../scenarios/mexican-place-des-arts.ts";
import type { RunSnapshot } from "../config/run-snapshot.ts";
import {
  agentStory,
  latestMessage,
  latestProgress,
  progressFractionAt,
  spotlightEvidence,
} from "./agent-story.ts";

const run = scenario.run;

describe("agentStory, read off the real run's log", () => {
  const story = agentStory(run, { spotlightIndex: 0, requirementId: "celiac" });

  it("finds the planner, the query and both sources", () => {
    expect(story.plannedAt).toBeCloseTo(5.4, 1);
    expect(story.queries.map((q) => q.text)).toEqual(["gluten free Mexican restaurant"]);
    expect(story.osm?.tagged).toBe(7);
    expect(story.maps?.scanned).toBe(32);
  });

  it("follows the ten places it opened, and what each one added", () => {
    expect(story.opened).toHaveLength(10);
    const laSelva = story.opened.find((o) => o.name === "La Selva restaurant mexicain")!;
    expect(laSelva.added).toBe(1);
    expect(laSelva.doneAt).toBeGreaterThan(laSelva.at);
  });

  it("times the spotlight quote to the page it was read from", () => {
    expect(story.spotlight?.evidence.quote).toBe(
      "I am celiac and ate tacos, shrimp, salad and rice safely.",
    );
    // "La Selva restaurant mexicain: detail page added 1 evidence item(s)"
    expect(story.spotlight?.at).toBeCloseTo(106.3, 1);
  });

  it("reads the run's own totals", () => {
    expect(story.finished).toMatchObject({ places: 15, evidence: 30, conflicted: 0 });
  });

  it("leaves out what an unfamiliar log does not say, instead of inventing it", () => {
    const quiet: RunSnapshot = { ...run, log: [{ t: 0, level: "info", message: "job started" }] };
    const empty = agentStory(quiet, { spotlightIndex: 0, requirementId: "celiac" });
    expect(empty.queries).toEqual([]);
    expect(empty.osm).toBeUndefined();
    expect(empty.opened).toEqual([]);
    // Totals fall back to the dossier itself.
    expect(empty.finished).toMatchObject({ places: 15, evidence: 30 });
  });
});

describe("spotlightEvidence", () => {
  it("picks the supporting quote for the ticked requirement over an empty 'unclear'", () => {
    expect(spotlightEvidence(run, 0, "celiac")?.polarity).toBe("supports");
  });

  it("falls back to any quote when the requirement has none", () => {
    // La Toxica: nothing settled celiac, but it has quotes about the cuisine.
    const index = run.places.findIndex((p) => p.name === "La Toxica");
    expect(spotlightEvidence(run, index, "celiac")?.requirementId).toBe("custom_mexican_restaurant");
  });
});

describe("the status card's read-outs", () => {
  it("skips bare progress ticks for the latest line", () => {
    expect(latestMessage(run, 7)).not.toMatch(/working$/);
  });

  it("fills the bar monotonically and never past full", () => {
    let prev = 0;
    for (let t = 0; t <= run.durationSec; t += 1) {
      const f = progressFractionAt(run, t);
      expect(f).toBeGreaterThanOrEqual(prev - 1e-9);
      expect(f).toBeLessThanOrEqual(1);
      prev = f;
    }
    expect(latestProgress(run, run.durationSec)?.progress.phase).toBe("dossier");
  });
});
