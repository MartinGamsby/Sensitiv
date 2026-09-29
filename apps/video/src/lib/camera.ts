import { clamp, lerp, type Point } from "./anim.ts";
import { CHROME_H, type Camera, type WindowPlacement } from "./choreography.ts";
import { VIEWPORT } from "./layout.ts";

export interface Shot {
  /** Where the focus point ends up in the frame. */
  target: Point;
  /** The focus point before the zoom, in frame pixels. */
  focus: Point;
  scale: number;
}

/**
 * The camera over the browser window, for one frame: scale about the focus
 * point, and ease that point toward the frame's centre as the zoom grows — at
 * scale 1 it is no transform at all. Once the zoomed window is bigger than
 * the frame, the shot slides back until none of the window's edges show.
 */
export function shotFor(
  win: WindowPlacement,
  cam: Camera,
  frame: { width: number; height: number },
): Shot {
  const focus = { x: win.x + cam.focus.x * win.scale, y: win.y + cam.focus.y * win.scale };
  const pull = clamp((cam.scale - 1) / 0.3);
  const target = {
    x: lerp(focus.x, frame.width / 2, pull),
    y: lerp(focus.y, frame.height / 2, pull),
  };
  const box = {
    left: win.x,
    top: win.y - CHROME_H * win.scale,
    right: win.x + VIEWPORT.width * win.scale,
    bottom: win.y + VIEWPORT.height * win.scale,
  };
  const onFrame = (v: number, f0: number, t0: number) => t0 + (v - f0) * cam.scale;
  const cover = (lo: number, hi: number, size: number) => {
    const excess = hi - lo - size;
    if (excess <= 0) return 0;
    const shift = lo > 0 ? -lo : hi < size ? size - hi : 0;
    // Phased in over the first 15% of overflow: switching on all at once
    // would jump the shot by however far the window was off-centre.
    return shift * clamp(excess / (0.15 * size));
  };
  target.x += cover(onFrame(box.left, focus.x, target.x), onFrame(box.right, focus.x, target.x), frame.width);
  target.y += cover(onFrame(box.top, focus.y, target.y), onFrame(box.bottom, focus.y, target.y), frame.height);
  return { target, focus, scale: cam.scale };
}

/** The CSS transform for a shot, with `transform-origin: 0 0`. */
export function shotTransform(shot: Shot): string {
  return (
    `translate(${shot.target.x}px, ${shot.target.y}px) scale(${shot.scale}) ` +
    `translate(${-shot.focus.x}px, ${-shot.focus.y}px)`
  );
}

/** A point in frame pixels, once the shot is applied. */
export function throughShot(shot: Shot, point: Point): Point {
  return {
    x: shot.target.x + (point.x - shot.focus.x) * shot.scale,
    y: shot.target.y + (point.y - shot.focus.y) * shot.scale,
  };
}
