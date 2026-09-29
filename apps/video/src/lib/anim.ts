// Motion helpers. Deliberately free of `remotion` imports so the choreography
// built on them is plain arithmetic that tests (and the asset script) can run.

export type Easing = (t: number) => number;

export function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

export function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

/** 0 before `start`, 1 after `start + duration`, eased in between. */
export function progress(
  frame: number,
  start: number,
  duration: number,
  easing: Easing = linear,
): number {
  if (duration <= 0) return frame >= start ? 1 : 0;
  return easing(clamp((frame - start) / duration));
}

export const linear: Easing = (t) => t;
export const inCubic: Easing = (t) => t * t * t;
export const outCubic: Easing = (t) => 1 - (1 - t) ** 3;
export const inOutCubic: Easing = (t) =>
  t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
export const outQuint: Easing = (t) => 1 - (1 - t) ** 5;
export const inOutQuint: Easing = (t) =>
  t < 0.5 ? 16 * t ** 5 : 1 - (-2 * t + 2) ** 5 / 2;
export const inOutSine: Easing = (t) => -(Math.cos(Math.PI * t) - 1) / 2;

/** Overshoots by `amount` and settles — a card landing, a pin dropping. */
export function outBack(amount = 1.70158): Easing {
  const c3 = amount + 1;
  return (t) => 1 + c3 * (t - 1) ** 3 + amount * (t - 1) ** 2;
}

/**
 * CSS `cubic-bezier(x1, y1, x2, y2)`, solved for x by Newton's method with a
 * bisection fallback — the same curve a designer would type into DevTools.
 */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): Easing {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t;
  const slopeX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  const solve = (x: number) => {
    let t = x;
    for (let i = 0; i < 8; i++) {
      const err = sampleX(t) - x;
      if (Math.abs(err) < 1e-6) return t;
      const d = slopeX(t);
      if (Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    let lo = 0;
    let hi = 1;
    t = x;
    for (let i = 0; i < 40; i++) {
      const v = sampleX(t);
      if (Math.abs(v - x) < 1e-6) break;
      if (v < x) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return t;
  };
  return (t) => (t <= 0 ? 0 : t >= 1 ? 1 : sampleY(solve(t)));
}

/** The "glide" most UI motion in the video uses: fast out, long settle. */
export const glide = cubicBezier(0.22, 1, 0.36, 1);
/** A camera move: gentle at both ends. */
export const dolly = cubicBezier(0.65, 0, 0.35, 1);

export interface Key<T> {
  at: number;
  value: T;
  /** Easing INTO this key from the previous one. */
  ease?: Easing;
}

/**
 * Value of a keyframed track at `frame`. Holds the first value before the
 * first key and the last after the last. `mix` blends two values, so the
 * same function tracks numbers, points or whole camera states.
 */
export function track<T>(
  frame: number,
  keys: readonly Key<T>[],
  mix: (a: T, b: T, t: number) => T,
): T {
  if (keys.length === 0) throw new Error("track needs at least one key");
  const first = keys[0]!;
  if (frame <= first.at) return first.value;
  for (let i = 1; i < keys.length; i++) {
    const b = keys[i]!;
    if (frame <= b.at) {
      const a = keys[i - 1]!;
      const span = b.at - a.at;
      const t = span <= 0 ? 1 : (frame - a.at) / span;
      return mix(a.value, b.value, (b.ease ?? inOutCubic)(clamp(t)));
    }
  }
  return keys[keys.length - 1]!.value;
}

export const mixNumber = (a: number, b: number, t: number) => lerp(a, b, t);

export interface Point {
  x: number;
  y: number;
}

export const mixPoint = (a: Point, b: Point, t: number): Point => ({
  x: lerp(a.x, b.x, t),
  y: lerp(a.y, b.y, t),
});

/** Deterministic pseudo-random in [0, 1) from a seed — the same jitter on
 *  every render of the same frame, which `Math.random` would not give. */
export function hash01(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}
