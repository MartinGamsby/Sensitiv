import { describe, expect, it } from "vitest";
import scenario from "../../scenarios/mexican-place-des-arts.ts";
import { defineScenario, type Scenario } from "../config/scenario.ts";
import { shotFor, throughShot } from "./camera.ts";
import {
  choreographyFor,
  researchUnwarp,
  researchWarp,
  type Choreography,
} from "./choreography.ts";
import { toViewPixel } from "./geo.ts";
import { dossierNotices } from "./marks.ts";
import { formLayout, intentPills, runLayout, type Rect } from "./layout.ts";
import { beatEnd } from "./timeline.ts";

function inside(r: Rect, p: { x: number; y: number }, slack = 0): boolean {
  return (
    p.x >= r.x - slack &&
    p.x <= r.x + r.width + slack &&
    p.y >= r.y - slack &&
    p.y <= r.y + r.height + slack
  );
}

/** A page rect as it sits in the viewport at frame `f`. */
function onScreen(chor: Choreography, f: number, r: Rect): Rect {
  return { ...r, y: r.y - chor.scroll(f) };
}

function withSearch(overrides: Partial<Scenario["search"]>): Scenario {
  return defineScenario({ ...scenario, search: { ...scenario.search, ...overrides } });
}

describe("every scripted click lands on what it is clicking", () => {
  const { chor, chipIds, intentLabels } = choreographyFor(scenario);
  const click = (target: string) => {
    const found = chor.clicks.find((c) => c.target === target);
    if (!found) throw new Error(`no ${target} click`);
    return found;
  };
  const closed = formLayout({ mapOpen: 0, intentRow: 0 });
  const open = formLayout({ mapOpen: 1, intentRow: 1 });
  const run = runLayout(dossierNotices(scenario.run).length);

  it("opens the map with the map button", () => {
    const c = click("mapButton");
    expect(inside(onScreen(chor, c.frame, closed.mapButton), c)).toBe(true);
  });

  it("drops the pin exactly where the pointer clicks", () => {
    const c = click("map");
    const map = onScreen(chor, c.frame, open.map);
    expect(inside(map, c)).toBe(true);
    // The distinguishing case: the pin must appear under the pointer, not
    // merely somewhere on the map.
    const state = chor.form.map(c.frame + 1);
    const pin = toViewPixel(state.view, state.marker);
    expect(Math.abs(map.x + pin.x - c.x)).toBeLessThan(3);
    expect(Math.abs(map.y + pin.y - c.y)).toBeLessThan(3);
  });

  it("ticks the scenario's requirement chip, not a neighbour", () => {
    const c = click("chip");
    const index = chipIds.indexOf(scenario.search.requirement);
    expect(inside(onScreen(chor, c.frame, open.chips[index]!), c)).toBe(true);
    for (const [i, other] of open.chips.entries()) {
      if (i !== index) expect(inside(onScreen(chor, c.frame, other), c)).toBe(false);
    }
  });

  it("leaves the intent pills alone: restaurants-only is the chip's default", () => {
    const pills = intentPills(open, intentLabels);
    for (const pill of pills) {
      for (const c of chor.clicks) {
        expect(inside(onScreen(chor, c.frame, pill), c)).toBe(false);
      }
    }
  });

  it("types into the request box and presses Start research", () => {
    const t = click("textarea");
    expect(inside(onScreen(chor, t.frame, open.textarea), t)).toBe(true);
    const s = click("submit");
    expect(inside(onScreen(chor, s.frame, open.submitButton), s)).toBe(true);
  });

  it("opens the spotlight card, then switches to the map", () => {
    const card = click("card");
    const spot = run.card(scenario.spotlight - 1);
    expect(inside(onScreen(chor, card.frame, spot), card)).toBe(true);
    const toggle = click("mapToggle");
    expect(inside(onScreen(chor, toggle.frame, run.mapToggle), toggle)).toBe(true);
  });

  it("lets go of the slider at the thumb for the scenario's radius", () => {
    const c = click("slider");
    const slider = onScreen(chor, c.frame, open.radiusSlider);
    const thumbX = slider.x + 8 + (slider.width - 16) * chor.form.slider(c.frame);
    expect(Math.abs(thumbX - c.x)).toBeLessThan(2);
    expect(inside(slider, c)).toBe(true);
  });
});

describe("the form ends up saying what the scenario says", () => {
  it("sets the radius and types the whole request", () => {
    const { chor, timeline } = choreographyFor(scenario);
    expect(chor.form.radiusKm(beatEnd(timeline, "radius"))).toBe(scenario.search.radiusKm);
    expect(chor.form.typed(beatEnd(timeline, "typeRequest"))).toBe(scenario.search.request.length);
  });

  it("follows a different radius and request too", () => {
    const other = withSearch({ radiusKm: 5, request: "Thai" });
    const { chor, timeline } = choreographyFor(other);
    expect(chor.form.radiusKm(beatEnd(timeline, "radius"))).toBe(5);
    expect(chor.form.typed(beatEnd(timeline, "typeRequest"))).toBe(4);
  });
});

describe("the camera", () => {
  // How far the window's corner moves from each frame to the next.
  function steps(): number[] {
    const { chor } = choreographyFor(scenario);
    const frame = { width: scenario.video.width, height: scenario.video.height };
    const corners = Array.from({ length: chor.totalFrames + 1 }, (_, f) =>
      throughShot(shotFor(chor.window(f), chor.camera(f), frame), chor.window(f)),
    );
    return corners.slice(1).map((c, i) => Math.hypot(c.x - corners[i]!.x, c.y - corners[i]!.y));
  }

  it("never cuts: no frame moves far more than the frames either side of it", () => {
    const d = steps();
    for (let i = 1; i < d.length - 1; i++) {
      // A jump is one frame's worth of motion far out of line with its
      // neighbours; a camera move ramps up and down over many frames.
      expect(d[i]!, `frame ${i + 1}`).toBeLessThan(2.5 * Math.max(d[i - 1]!, d[i + 1]!) + 12);
    }
  });

  it("never whips: even the fastest move stays watchable", () => {
    expect(Math.max(...steps())).toBeLessThan(90);
  });
});

describe("the research clock", () => {
  it("unwarps back to the run's own seconds", () => {
    const warp = researchWarp(scenario);
    const unwarp = researchUnwarp(scenario);
    for (const t of [0.5, 5, 30, 76, 110, 129]) {
      expect(unwarp(warp(t))).toBeCloseTo(t, 3);
    }
  });

  it("only moves forward", () => {
    const warp = researchWarp(scenario);
    let prev = -1;
    for (let t = 0; t <= scenario.run.durationSec; t += 0.5) {
      expect(warp(t)).toBeGreaterThanOrEqual(prev);
      prev = warp(t);
    }
  });

  it("runs past the end, so the finished state gets to show", () => {
    const { chor, timeline } = choreographyFor(scenario);
    expect(chor.run.runSeconds(beatEnd(timeline, "research") - 1)).toBeGreaterThan(
      scenario.run.durationSec,
    );
  });
});
