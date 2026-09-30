import { describe, expect, it } from "vitest";
import { TimingSchema } from "../config/scenario.ts";
import { BEATS, SCENES, buildTimeline, secondsToFrames } from "./timeline.ts";

describe("buildTimeline", () => {
  const timing = TimingSchema.parse({});

  it("lays the beats end to end inside the walkthrough", () => {
    const tl = buildTimeline(timing, 30);
    let at = 0;
    for (const beat of BEATS) {
      expect(tl.beats[beat].from).toBe(at);
      at += tl.beats[beat].durationInFrames;
    }
    expect(tl.scenes.walkthrough.durationInFrames).toBe(at);
  });

  it("overlaps neighbouring scenes by the transition and nothing else", () => {
    const tl = buildTimeline(timing, 30);
    for (let i = 1; i < SCENES.length; i++) {
      const prev = tl.scenes[SCENES[i - 1]!];
      const next = tl.scenes[SCENES[i]!];
      expect(prev.from + prev.durationInFrames - next.from).toBe(tl.transition);
    }
    const outro = tl.scenes.outro;
    expect(tl.durationInFrames).toBe(outro.from + outro.durationInFrames);
  });

  it("scales with the frame rate", () => {
    const at30 = buildTimeline(timing, 30).durationInFrames;
    const at60 = buildTimeline(timing, 60).durationInFrames;
    expect(Math.abs(at60 - 2 * at30)).toBeLessThanOrEqual(SCENES.length + BEATS.length);
  });

  it("never makes a beat zero frames long", () => {
    expect(secondsToFrames(0.001, 30)).toBe(1);
  });
});
