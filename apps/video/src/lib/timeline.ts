import type { Timing } from "../config/scenario.ts";

// Seconds in the scenario, frames everywhere else. One place turns the one
// into the other so a scene never disagrees with the composition about where
// it starts.

/** The walkthrough's beats, in playing order. */
export const BEATS = [
  "enter",
  "openMap",
  "findPin",
  "dropPin",
  "radius",
  "toChips",
  "requirement",
  "toRequest",
  "typeRequest",
  "submit",
  "research",
  "results",
  "evidence",
  "mapView",
  "exit",
] as const;
export type Beat = (typeof BEATS)[number];

export const SCENES = ["hook", "brand", "walkthrough", "outro"] as const;
export type SceneId = (typeof SCENES)[number];

export interface Span {
  /** First frame. */
  from: number;
  durationInFrames: number;
}

export interface Timeline {
  fps: number;
  /** Total length of the video, in frames. */
  durationInFrames: number;
  /** Frames the neighbouring top-level scenes overlap by. */
  transition: number;
  /** Top-level scenes, in absolute frames. Neighbours overlap by `transition`. */
  scenes: Record<SceneId, Span>;
  /** Walkthrough beats, in frames RELATIVE to the walkthrough's own start. */
  beats: Record<Beat, Span>;
}

export function secondsToFrames(seconds: number, fps: number): number {
  return Math.max(1, Math.round(seconds * fps));
}

export function buildTimeline(timing: Timing, fps: number): Timeline {
  const transition = Math.round(timing.transition * fps);

  const beats = {} as Record<Beat, Span>;
  let cursor = 0;
  for (const beat of BEATS) {
    const durationInFrames = secondsToFrames(timing[beat], fps);
    beats[beat] = { from: cursor, durationInFrames };
    cursor += durationInFrames;
  }
  const walkthrough = cursor;

  const lengths: Record<SceneId, number> = {
    hook: secondsToFrames(timing.hook, fps),
    brand: secondsToFrames(timing.brand, fps),
    walkthrough,
    outro: secondsToFrames(timing.outro, fps),
  };

  const scenes = {} as Record<SceneId, Span>;
  let at = 0;
  SCENES.forEach((id, i) => {
    // Every scene after the first starts `transition` frames before its
    // predecessor ends, so the two cross-fade instead of cutting.
    if (i > 0) at -= Math.min(transition, lengths[id], lengths[SCENES[i - 1]!]);
    scenes[id] = { from: at, durationInFrames: lengths[id] };
    at += lengths[id];
  });

  return { fps, durationInFrames: at, transition, scenes, beats };
}

/** 0..1 through a beat (clamped), for a frame relative to the walkthrough. */
export function beatProgress(tl: Timeline, beat: Beat, frame: number): number {
  const span = tl.beats[beat];
  return Math.min(1, Math.max(0, (frame - span.from) / span.durationInFrames));
}

export function beatStart(tl: Timeline, beat: Beat): number {
  return tl.beats[beat].from;
}

export function beatEnd(tl: Timeline, beat: Beat): number {
  const span = tl.beats[beat];
  return span.from + span.durationInFrames;
}

/** A frame `seconds` into a beat — for choreography written in seconds. */
export function at(tl: Timeline, beat: Beat, seconds = 0): number {
  return tl.beats[beat].from + seconds * tl.fps;
}

/** A frame at `fraction` of the way through a beat. */
export function within(tl: Timeline, beat: Beat, fraction: number): number {
  const span = tl.beats[beat];
  return span.from + span.durationInFrames * fraction;
}
