import { DEFAULT_RADIUS_KM, MAX_RADIUS_KM, MIN_RADIUS_KM } from "@sensitiv/shared";
import {
  getIntent,
  getRequirement,
  labelOf,
  requirements,
} from "@sensitiv/shared/catalog/index";
import type { Scenario, Variant } from "../config/scenario.ts";
import {
  clamp,
  dolly,
  glide,
  hash01,
  inOutCubic,
  lerp,
  mixNumber,
  outCubic,
  progress,
  track,
  type Key,
  type Point,
} from "./anim.ts";
import {
  interpolateView,
  zoomToFitCircle,
  zoomToFitPoints,
  type LatLng,
  type MapView,
} from "./geo.ts";
import {
  DETAIL,
  HEADER_H,
  VIEWPORT,
  center,
  formLayout,
  intentPills,
  runLayout,
  sliderFraction,
  sliderKm,
  type Rect,
} from "./layout.ts";
import type { SoundName } from "./assets.ts";
import { dossierNotices } from "./marks.ts";
import {
  at,
  beatEnd,
  beatStart,
  buildTimeline,
  within,
  type Timeline,
} from "./timeline.ts";

// Where everything in the walkthrough is on a given frame: the page scroll,
// the camera, the cursor, the two maps and every piece of UI state. Frames
// here are RELATIVE to the walkthrough's first frame.
//
// It is one pure function of the scenario and the timeline — no React — so
// the scene draws from it and `scripts/assets.ts` can replay the same map
// moves to learn which tiles a render will ask for.

/** Height of the fake browser's title/address bar, in app pixels. */
export const CHROME_H = 44;

export interface WindowPlacement {
  /** Frame pixels of the viewport's top-left corner (below the chrome). */
  x: number;
  y: number;
  /** Frame pixels per app pixel. */
  scale: number;
  opacity: number;
  /** Degrees of forward tilt, for the entrance. */
  tilt: number;
}

export interface Camera {
  scale: number;
  /** The point, in viewport coordinates, the camera centres on. */
  focus: Point;
}

export interface CursorState extends Point {
  /** 0..1 — how far the button is down. */
  press: number;
  visible: number;
}

export type ClickTarget =
  | "mapButton"
  | "map"
  | "chip"
  | "textarea"
  | "submit"
  | "card"
  | "mapToggle"
  | "slider";

export interface Click extends Point {
  frame: number;
  /** What the click is meant to hit — the tests check that it does. */
  target: ClickTarget;
}

/** A sound at a frame (walkthrough-relative), at a relative volume. */
export interface Cue {
  frame: number;
  sound: SoundName;
  volume: number;
}

export interface FormMapState {
  view: MapView;
  /** The circle the map draws, and where. */
  circleCenter: LatLng;
  circleKm: number;
  /** The marker: faded "suggestion" before the drop, then the dropped pin. */
  marker: LatLng;
  /** 0 = not dropped (faded marker at the map's start), 1 = landed. */
  drop: number;
  /** 0..1 — the video's own "Place des Arts" label beside the pin. */
  callout: number;
}

export interface Choreography {
  totalFrames: number;
  page: (f: number) => "form" | "run";
  /** 0..1 cross-fade from the form to the run page. */
  pageSwap: (f: number) => number;
  /** Scroll of whichever page is showing. */
  scroll: (f: number) => number;
  formScroll: (f: number) => number;
  runScroll: (f: number) => number;
  window: (f: number) => WindowPlacement;
  camera: (f: number) => Camera;
  cursor: (f: number) => CursorState;
  clicks: Click[];
  form: {
    mapOpen: (f: number) => number;
    intentRow: (f: number) => number;
    chipOn: (f: number) => number;
    /** 0..1 — the location field filling with the pin's name. */
    located: (f: number) => number;
    radiusKm: (f: number) => number;
    /** The slider thumb's position, 0..1 of the track. */
    slider: (f: number) => number;
    /** Characters of the request typed so far. */
    typed: (f: number) => number;
    /** 0..1 — the textarea has focus. */
    textareaFocus: (f: number) => number;
    /** 0..1 — the Dining pill's "this one" pulse. */
    intentPulse: (f: number) => number;
    submitting: (f: number) => number;
    map: (f: number) => FormMapState;
  };
  run: {
    /** Seconds of the real run elapsed by this frame (warped to fit). */
    runSeconds: (f: number) => number;
    /** 0..1 — the status card turning into "Done" and folding. */
    done: (f: number) => number;
    /** 0..1 — the dossier section appearing. */
    dossier: (f: number) => number;
    /** 0..1 per card, staggered by rank. */
    cardIn: (f: number, index: number) => number;
    detail: (f: number) => number;
    /** 0..1 — the spotlight card lit up as the pointer arrives on it. */
    hoverCard: (f: number) => number;
    /** 0..1 — the dialog scrolled down to the evidence. */
    detailScroll: (f: number) => number;
    /** 0..1 — the highlighter sweeping the spotlight quote. */
    highlight: (f: number) => number;
    mapView: (f: number) => number;
    /** 0..1 per pin, staggered by rank. */
    pinIn: (f: number, index: number) => number;
    resultsMap: (f: number) => MapView;
  };
  /** 0..1 — the agent panel beside the window during research. */
  agent: (f: number) => number;
  /** When the interface makes a sound: every click, key, landing and swoop. */
  cues: Cue[];
}

export interface ChoreographyInput {
  scenario: Scenario;
  timeline: Timeline;
  /** Labels of the ticked requirement's intents, in catalog order. */
  intentLabels: readonly string[];
  /** Position of the ticked requirement among the form's chips. */
  chipIndex: number;
  /** The video frame, in pixels. */
  frame: { width: number; height: number };
  /**
   * Hold every shot still between deliberate moves, and keep maps from
   * drifting — for the GIF, where a slow push-in redraws the whole picture on
   * every frame of a hold.
   */
  still?: boolean;
}

/** `zoomFor` in the web app's `location-map.tsx`: the map's opening zoom. */
export function formMapOpeningZoom(radiusKm: number): number {
  if (radiusKm <= 1) return 14;
  if (radiusKm <= 3) return 13;
  if (radiusKm <= 5) return 12;
  return 11;
}

/** Zoom the map flies to before the pin goes in — close enough to read the
 *  street names around the spot. */
const PIN_ZOOM = 15.2;

/** The form map is drawn this size; the zoom maths need to know it. */
export function formMapSize(): { width: number; height: number } {
  const map = formLayout({ mapOpen: 1, intentRow: 1 }).map;
  return { width: map.width, height: map.height };
}

/** Places the results map should show — ranked, with coordinates. */
export function mappablePlaces(scenario: Scenario): Array<LatLng & { rank: number }> {
  return scenario.run.places
    .slice(0, scenario.visiblePlaces)
    .flatMap((place, i) =>
      place.lat !== undefined && place.lng !== undefined
        ? [{ lat: place.lat, lng: place.lng, rank: i + 1 }]
        : [],
    );
}

/** The search centre the run resolved, else the pin the scenario drops. */
export function searchCenter(scenario: Scenario): LatLng {
  return scenario.run.searchCenter ?? { lat: scenario.search.pin.lat, lng: scenario.search.pin.lng };
}

/**
 * Real run seconds → fraction of the research beat. Piecewise linear through
 * the run's own phase changes, so planning is readable instead of lasting
 * two frames, and the long reading stretch is compressed hardest.
 */
export function researchWarp(scenario: Scenario): (runSec: number) => number {
  const log = scenario.run.log;
  const end = Math.max(scenario.run.durationSec, log.at(-1)?.t ?? 0, 1);
  const firstT = (pred: (e: (typeof log)[number]) => boolean, fallback: number) =>
    log.find(pred)?.t ?? fallback;
  const sources = firstT((e) => e.progress?.phase === "sources", end * 0.05);
  const reading = firstT((e) => e.progress?.unit === "place", end * 0.55);
  const merge = firstT((e) => e.progress?.phase === "merge", end * 0.98);
  // Anchors must rise strictly, whatever order a strange log produced.
  const runAnchors = [0, sources, reading, merge, end];
  for (let i = 1; i < runAnchors.length; i++) {
    runAnchors[i] = Math.max(runAnchors[i]!, runAnchors[i - 1]! + 0.01);
  }
  const videoAnchors = [0.05, 0.2, 0.5, 0.84, 0.9];
  return (runSec: number) => {
    if (runSec <= 0) return videoAnchors[0]!;
    for (let i = 1; i < runAnchors.length; i++) {
      if (runSec <= runAnchors[i]!) {
        const a = runAnchors[i - 1]!;
        const b = runAnchors[i]!;
        return lerp(videoAnchors[i - 1]!, videoAnchors[i]!, (runSec - a) / (b - a));
      }
    }
    return videoAnchors[videoAnchors.length - 1]!;
  };
}

/** The warp's inverse: research-beat fraction → real run seconds. */
export function researchUnwarp(scenario: Scenario): (fraction: number) => number {
  const warp = researchWarp(scenario);
  const end = Math.max(scenario.run.durationSec, scenario.run.log.at(-1)?.t ?? 0, 1);
  const last = warp(end);
  return (fraction: number) => {
    if (fraction <= warp(0)) return 0;
    // Past the run's end the clock keeps going a little, so whatever waits
    // on "finished" gets to play out before the beat ends.
    if (fraction >= last) return end + ((fraction - last) / Math.max(1e-6, 1 - last)) * 4;
    let lo = 0;
    let hi = end;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (warp(mid) < fraction) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  };
}

/** Curves a cursor move slightly, the way a hand does. */
function mixCursor(a: Point, b: Point, t: number): Point {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  const bow = Math.min(60, len * 0.12) * Math.sin(Math.PI * t);
  return {
    x: a.x + dx * t + (len > 0 ? (-dy / len) * bow : 0),
    y: a.y + dy * t + (len > 0 ? (dx / len) * bow : 0),
  };
}

function mixCamera(a: Camera, b: Camera, t: number): Camera {
  return {
    scale: lerp(a.scale, b.scale, t),
    focus: { x: lerp(a.focus.x, b.focus.x, t), y: lerp(a.focus.y, b.focus.y, t) },
  };
}

function mixWindow(a: WindowPlacement, b: WindowPlacement, t: number): WindowPlacement {
  return {
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
    scale: lerp(a.scale, b.scale, t),
    opacity: lerp(a.opacity, b.opacity, t),
    tilt: lerp(a.tilt, b.tilt, t),
  };
}

/** A viewport point after a page scroll: page y minus the scroll. */
function onScreen(point: Point, scrollY: number): Point {
  return { x: point.x, y: point.y - scrollY };
}

/** Scroll that puts `rect` at `top` below the sticky header. */
function scrollTo(rect: Rect, top = 28): number {
  return Math.max(0, rect.y - HEADER_H - top);
}

export function createChoreography(input: ChoreographyInput): Choreography {
  const { scenario, timeline: tl, intentLabels, chipIndex } = input;
  const fps = tl.fps;
  const s = (seconds: number) => seconds * fps;
  const W = input.frame.width;
  const H = input.frame.height;
  const totalFrames = beatEnd(tl, "exit");

  // --- the window ----------------------------------------------------------
  const homeScale = Math.min(
    (W * 0.82) / VIEWPORT.width,
    (H * 0.84) / (VIEWPORT.height + CHROME_H),
  );
  const home: WindowPlacement = {
    scale: homeScale,
    x: (W - VIEWPORT.width * homeScale) / 2,
    y: (H - (VIEWPORT.height + CHROME_H) * homeScale) / 2 + CHROME_H * homeScale,
    opacity: 1,
    tilt: 0,
  };
  const sideScale = homeScale * 0.7;
  const side: WindowPlacement = {
    scale: sideScale,
    x: W * 0.05,
    y: (H - (VIEWPORT.height + CHROME_H) * sideScale) / 2 + CHROME_H * sideScale - H * 0.02,
    opacity: 1,
    tilt: 0,
  };
  const offstage: WindowPlacement = { ...home, y: home.y + H * 0.14, opacity: 0, tilt: 16 };
  const shrink: WindowPlacement = {
    ...home,
    scale: homeScale * 0.9,
    x: (W - VIEWPORT.width * homeScale * 0.9) / 2,
    y: home.y + H * 0.05,
    opacity: 0,
  };

  const windowKeys: Key<WindowPlacement>[] = [
    { at: 0, value: offstage },
    { at: at(tl, "enter", 1.1), value: home, ease: glide },
    { at: at(tl, "research", 0.95), value: home },
    { at: at(tl, "research", 1.85), value: side, ease: dolly },
    { at: beatStart(tl, "results"), value: side },
    { at: at(tl, "results", 0.8), value: home, ease: dolly },
    { at: beatStart(tl, "exit"), value: home },
    { at: beatEnd(tl, "exit"), value: shrink, ease: inOutCubic },
  ];

  // --- the form ------------------------------------------------------------
  const open = formLayout({ mapOpen: 1, intentRow: 1 });
  const closed = formLayout({ mapOpen: 0, intentRow: 0 });
  const pins = intentPills(open, intentLabels);
  const chip = open.chips[Math.max(0, chipIndex)] ?? open.chips[0]!;

  const S_MAP = Math.min(180, scrollTo(open.card1, -140));
  const S_CHIPS = scrollTo(open.card2, 28);
  const S_REQUEST = scrollTo(open.card3, 12);
  const S_SUBMIT = Math.max(
    S_REQUEST,
    open.submitCard.y + open.submitCard.height + 24 - VIEWPORT.height,
  );

  const pin = scenario.search.pin;
  const mapSize = formMapSize();
  const startRadius = DEFAULT_RADIUS_KM;
  const endRadius = scenario.search.radiusKm;
  const startView: MapView = {
    center: scenario.search.mapStart,
    zoom: formMapOpeningZoom(startRadius),
    ...mapSize,
  };
  const pinView: MapView = { center: pin, zoom: PIN_ZOOM, ...mapSize };
  const fitView: MapView = {
    center: pin,
    zoom: zoomToFitCircle(pin, endRadius, mapSize.width, mapSize.height, 16),
    ...mapSize,
  };

  // Slider: where the thumb starts and ends, in viewport x.
  const sliderStart = sliderFraction(startRadius, MIN_RADIUS_KM, MAX_RADIUS_KM);
  const sliderEnd = sliderFraction(endRadius, MIN_RADIUS_KM, MAX_RADIUS_KM);
  const thumbX = (fraction: number) =>
    open.radiusSlider.x + 8 + (open.radiusSlider.width - 16) * fraction;
  const sliderY = center(open.radiusSlider).y;

  const radiusDrag = {
    from: at(tl, "radius", 0.85),
    to: at(tl, "radius", 1.75),
  };

  // --- scroll ------------------------------------------------------------------
  const runPageAt = beatStart(tl, "research");
  // "Starting…" holds while the camera pulls back; the new page arrives once
  // the shot is wide, the way a navigation lands.
  const swapAt = at(tl, "research", 0.55);
  const run = runLayout(dossierNotices(scenario.run).length);
  const S_RESULTS = 170;
  const S_MAPVIEW = Math.max(
    S_RESULTS,
    run.resultsMap.y + run.resultsMap.height + 16 - VIEWPORT.height,
  );

  const formScrollKeys: Key<number>[] = [
    { at: 0, value: 0 },
    { at: within(tl, "openMap", 0.7), value: 0 },
    { at: at(tl, "findPin", 0.55), value: S_MAP, ease: dolly },
    { at: beatStart(tl, "toChips"), value: S_MAP },
    { at: beatEnd(tl, "toChips"), value: S_CHIPS, ease: dolly },
    { at: beatStart(tl, "toRequest"), value: S_CHIPS },
    { at: beatEnd(tl, "toRequest"), value: S_REQUEST, ease: dolly },
    { at: within(tl, "submit", 0.05), value: S_REQUEST },
    { at: within(tl, "submit", 0.4), value: S_SUBMIT, ease: dolly },
  ];
  const runScrollKeys: Key<number>[] = [
    { at: runPageAt, value: 0 },
    { at: at(tl, "results", 1.2), value: 0 },
    { at: at(tl, "results", 2.6), value: S_RESULTS, ease: dolly },
    // The Map toggle is clicked first, at this scroll; only then does the page
    // move down to show the whole map — scrolling first would park the toggle
    // under the sticky header.
    { at: at(tl, "mapView", 1.3), value: S_RESULTS },
    { at: at(tl, "mapView", 2.2), value: S_MAPVIEW, ease: dolly },
  ];
  // One track per page: both are on screen while one fades into the other,
  // and each has to hold its own scroll through that.
  const formScroll = (f: number) => track(f, formScrollKeys, mixNumber);
  const runScroll = (f: number) => track(f, runScrollKeys, mixNumber);
  const scroll = (f: number) =>
    progress(f, swapAt, s(0.35), inOutCubic) < 0.5 ? formScroll(f) : runScroll(f);

  // --- clicks & cursor -----------------------------------------------------------
  const clickAt = {
    mapButton: within(tl, "openMap", 0.55),
    map: at(tl, "dropPin", 0.1),
    sliderDown: radiusDrag.from - s(0.08),
    chip: within(tl, "requirement", 0.2),
    textarea: at(tl, "typeRequest", 0.12),
    submit: within(tl, "submit", 0.62),
    card: at(tl, "evidence", 0.35),
    mapToggle: at(tl, "mapView", 1.05),
  };

  const mapCenterOnScreen = onScreen(center(open.map), S_MAP);
  const spotlightIndex = Math.min(scenario.spotlight, scenario.run.places.length) - 1;
  const spotlightCard = onScreen(center(run.card(spotlightIndex)), S_RESULTS);
  const mapToggle = onScreen(center(run.mapToggle), S_RESULTS);

  const cursorKeys: Key<Point>[] = [
    { at: 0, value: { x: 820, y: 640 } },
    { at: within(tl, "enter", 0.9), value: { x: 760, y: 560 } },
    { at: within(tl, "openMap", 0.45), value: onScreen(center(closed.mapButton), 0) },
    { at: within(tl, "openMap", 0.8), value: onScreen(center(closed.mapButton), 0) },
    // While the map flies, the pointer drifts to where the pin will go.
    { at: within(tl, "findPin", 0.85), value: mapCenterOnScreen, ease: inOutCubic },
    { at: at(tl, "dropPin", 0.3), value: mapCenterOnScreen },
    { at: radiusDrag.from - s(0.2), value: { x: thumbX(sliderStart), y: sliderY - S_MAP } },
    { at: radiusDrag.from, value: { x: thumbX(sliderStart), y: sliderY - S_MAP } },
    {
      at: radiusDrag.to,
      value: { x: thumbX(sliderEnd), y: sliderY - S_MAP },
      ease: inOutCubic,
    },
    { at: beatStart(tl, "toChips"), value: { x: thumbX(sliderEnd) + 30, y: sliderY - S_MAP + 40 } },
    { at: within(tl, "requirement", 0.15), value: onScreen(center(chip), S_CHIPS) },
    { at: within(tl, "requirement", 0.45), value: onScreen(center(chip), S_CHIPS) },
    {
      at: within(tl, "requirement", 0.72),
      value: onScreen(center(pins[0] ?? chip), S_CHIPS),
    },
    { at: beatEnd(tl, "requirement"), value: onScreen(center(pins[0] ?? chip), S_CHIPS) },
    {
      at: at(tl, "typeRequest", 0.05),
      value: onScreen({ x: open.textarea.x + 180, y: open.textarea.y + 40 }, S_REQUEST),
    },
    {
      at: within(tl, "submit", 0.5),
      value: onScreen(center(open.submitButton), S_SUBMIT),
    },
    {
      at: within(tl, "submit", 0.85),
      value: onScreen(center(open.submitButton), S_SUBMIT),
    },
    { at: at(tl, "results", 2.4), value: { x: 980, y: 560 } },
    { at: at(tl, "evidence", 0.25), value: spotlightCard },
    { at: at(tl, "evidence", 0.7), value: spotlightCard },
    { at: at(tl, "evidence", 1.6), value: { x: DETAIL.x + DETAIL.width + 40, y: 380 } },
    { at: at(tl, "mapView", 0.4), value: { x: DETAIL.x + DETAIL.width + 40, y: 380 } },
    { at: at(tl, "mapView", 0.95), value: mapToggle },
    { at: at(tl, "mapView", 1.25), value: mapToggle },
    {
      at: at(tl, "mapView", 2.6),
      value: { x: run.resultsMap.x + run.resultsMap.width * 0.72, y: 520 },
    },
  ];

  const cursorPoint = (f: number) => track(f, cursorKeys, mixCursor);

  // The button presses, in order. The slider is held rather than pressed, so
  // it joins `clicks` (for its ripple and the tests) but not `pressAt`.
  const presses = (
    [
      ["mapButton", clickAt.mapButton],
      ["map", clickAt.map],
      ["chip", clickAt.chip],
      ["textarea", clickAt.textarea],
      ["submit", clickAt.submit],
      ["card", clickAt.card],
      ["mapToggle", clickAt.mapToggle],
    ] as const
  ).map(([target, frame]): Click => ({ target, frame, ...cursorPoint(frame) }));
  const pressAt = presses.map((p) => p.frame);
  const clicks: Click[] = [
    ...presses,
    // Letting go of the slider thumb.
    { target: "slider", frame: radiusDrag.to + s(0.02), ...cursorPoint(radiusDrag.to) },
  ];

  const cursor = (f: number): CursorState => {
    const point = cursorPoint(f);
    let press = 0;
    for (const t of pressAt) {
      const d = f - t;
      if (d >= -s(0.06) && d <= s(0.14)) {
        press = Math.max(press, d < 0 ? 1 + d / s(0.06) : 1 - d / s(0.14));
      }
    }
    // Holding the slider thumb.
    if (f >= clickAt.sliderDown && f <= radiusDrag.to + s(0.05)) press = 1;

    const typingFrom = at(tl, "typeRequest", 0.25);
    const typingTo = beatEnd(tl, "typeRequest");
    const visible = Math.min(
      progress(f, s(0.4), s(0.4)),
      // Hidden while typing, like a real pointer.
      1 - progress(f, typingFrom, s(0.2)) + progress(f, typingTo - s(0.1), s(0.3)),
      // Gone while the run is researching; back for the results.
      1 - progress(f, swapAt - s(0.15), s(0.25)) + progress(f, at(tl, "results", 1.6), s(0.4)),
      1 - progress(f, beatStart(tl, "exit"), s(0.3)),
    );
    return { ...point, press: clamp(press), visible: clamp(visible) };
  };

  // --- camera ------------------------------------------------------------------
  const wide: Camera = { scale: 1, focus: { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 } };
  const onMap: Camera = { scale: 1.55, focus: mapCenterOnScreen };
  const onRadius: Camera = {
    scale: 1.22,
    focus: { x: VIEWPORT.width / 2, y: (sliderY - S_MAP + mapCenterOnScreen.y) / 2 - 20 },
  };
  const chipsFocus = onScreen(
    { x: open.card2.x + open.card2.width * 0.42, y: open.card2.y + 150 },
    S_CHIPS,
  );
  const textareaFocus = onScreen(center(open.textarea), S_REQUEST);
  const submitFocus = onScreen(
    { x: open.submitButton.x - 120, y: center(open.submitButton).y },
    S_SUBMIT,
  );
  const gridFocus = onScreen(
    { x: VIEWPORT.width / 2, y: run.card(0).y + 60 },
    S_RESULTS,
  );
  const detailTop: Camera = {
    scale: 1.12,
    focus: { x: VIEWPORT.width / 2, y: DETAIL.y + 250 },
  };
  // Where the spotlight quote sits once the dialog has scrolled to it.
  const detailQuote: Camera = {
    scale: 1.34,
    focus: { x: VIEWPORT.width / 2, y: DETAIL.y + 470 },
  };
  const mapFocus = onScreen(center(run.resultsMap), S_MAPVIEW);

  // A slow push-in keeps a held shot alive in the video; the GIF holds still.
  const drift = (to: number, from: number) => (input.still ? from : to);

  const cameraKeys: Key<Camera>[] = [
    { at: 0, value: wide },
    { at: within(tl, "openMap", 0.4), value: wide },
    { at: within(tl, "findPin", 0.75), value: onMap, ease: dolly },
    { at: beatEnd(tl, "dropPin"), value: { ...onMap, scale: drift(1.62, onMap.scale) }, ease: inOutCubic },
    { at: at(tl, "radius", 0.9), value: onRadius, ease: dolly },
    { at: beatEnd(tl, "radius"), value: onRadius },
    { at: beatEnd(tl, "toChips"), value: { scale: 1.3, focus: chipsFocus }, ease: dolly },
    { at: beatEnd(tl, "requirement"), value: { scale: drift(1.34, 1.3), focus: chipsFocus } },
    { at: at(tl, "typeRequest", 0.3), value: { scale: 1.5, focus: textareaFocus }, ease: dolly },
    { at: beatEnd(tl, "typeRequest"), value: { scale: drift(1.55, 1.5), focus: textareaFocus } },
    { at: within(tl, "submit", 0.55), value: { scale: 1.32, focus: submitFocus }, ease: dolly },
    { at: clickAt.submit + s(0.15), value: { scale: drift(1.36, 1.32), focus: submitFocus } },
    { at: at(tl, "research", 0.6), value: wide, ease: dolly },
    { at: at(tl, "results", 1.4), value: wide },
    { at: at(tl, "results", 2.8), value: { scale: 1.1, focus: gridFocus }, ease: dolly },
    { at: at(tl, "evidence", 0.4), value: { scale: 1.1, focus: gridFocus } },
    { at: at(tl, "evidence", 1.4), value: detailTop, ease: dolly },
    { at: at(tl, "evidence", 2.6), value: detailTop },
    { at: at(tl, "evidence", 3.6), value: detailQuote, ease: dolly },
    { at: beatEnd(tl, "evidence") - s(0.3), value: { ...detailQuote, scale: drift(1.42, detailQuote.scale) } },
    { at: at(tl, "mapView", 0.9), value: wide, ease: dolly },
    { at: at(tl, "mapView", 1.6), value: wide },
    { at: at(tl, "mapView", 2.6), value: { scale: 1.16, focus: mapFocus }, ease: dolly },
    { at: beatEnd(tl, "mapView"), value: { scale: drift(1.2, 1.16), focus: mapFocus } },
    { at: beatEnd(tl, "exit"), value: wide, ease: dolly },
  ];

  // --- form state -----------------------------------------------------------------
  const mapOpen = (f: number) => progress(f, clickAt.mapButton + s(0.05), s(0.55), glide);
  const chipOn = (f: number) => progress(f, clickAt.chip + s(0.02), s(0.22), outCubic);
  const intentRow = (f: number) => progress(f, clickAt.chip + s(0.12), s(0.35), glide);
  const located = (f: number) => progress(f, clickAt.map + s(0.45), s(0.35), outCubic);
  const slider = (f: number) =>
    lerp(sliderStart, sliderEnd, progress(f, radiusDrag.from, radiusDrag.to - radiusDrag.from, inOutCubic));
  const radiusKm = (f: number) => sliderKm(slider(f), MIN_RADIUS_KM, MAX_RADIUS_KM);
  /** The drawn circle follows the thumb continuously, not in 0.5 km steps. */
  const smoothKm = (f: number) => {
    const t = clamp(slider(f));
    return MIN_RADIUS_KM + (MAX_RADIUS_KM - MIN_RADIUS_KM) * t * t;
  };

  const request = scenario.search.request;
  const typeFrom = at(tl, "typeRequest", 0.3);
  const typeTo = beatEnd(tl, "typeRequest") - s(0.25);
  // Human rhythm: every keystroke a slightly different length.
  const keyTimes: number[] = [];
  {
    const weights = [...request].map((_, i) => 0.6 + hash01(i + request.length) * 0.8);
    const total = weights.reduce((a, b) => a + b, 0);
    let acc = 0;
    for (const w of weights) {
      acc += w;
      keyTimes.push(typeFrom + ((typeTo - typeFrom) * acc) / total);
    }
  }
  const typed = (f: number) => keyTimes.filter((t) => t <= f).length;

  const formMap = (f: number): FormMapState => {
    const flight = progress(f, within(tl, "findPin", 0.1), tl.beats.findPin.durationInFrames * 0.75, dolly);
    const drag = progress(f, radiusDrag.from, radiusDrag.to - radiusDrag.from, inOutCubic);
    const view =
      f < radiusDrag.from
        ? interpolateView(startView, pinView, flight)
        : interpolateView(pinView, fitView, drag);
    const dropped = f >= clickAt.map;
    return {
      view,
      circleCenter: dropped ? pin : scenario.search.mapStart,
      circleKm: smoothKm(f),
      marker: dropped ? pin : scenario.search.mapStart,
      drop: dropped ? progress(f, clickAt.map, s(0.55)) : 0,
      callout: progress(f, clickAt.map + s(0.3), s(0.45), glide),
    };
  };

  // --- run page state ---------------------------------------------------------------
  const unwarp = researchUnwarp(scenario);
  const runSeconds = (f: number) => {
    const span = tl.beats.research;
    return unwarp((f - span.from) / span.durationInFrames);
  };
  const done = (f: number) => progress(f, within(tl, "research", 0.93), s(0.5), glide);
  const dossier = (f: number) => progress(f, at(tl, "results", 0.35), s(0.5), glide);
  const cardIn = (f: number, index: number) =>
    progress(f, at(tl, "results", 0.55 + index * 0.08), s(0.55), glide);
  const detail = (f: number) =>
    progress(f, clickAt.card + s(0.05), s(0.4), glide) *
    (1 - progress(f, at(tl, "mapView", 0.1), s(0.3), outCubic));
  const highlight = (f: number) => progress(f, at(tl, "evidence", 3.5), s(0.9), inOutCubic);
  const mapView = (f: number) => progress(f, clickAt.mapToggle + s(0.05), s(0.4), glide);
  const pinIn = (f: number, index: number) =>
    progress(f, clickAt.mapToggle + s(0.35 + index * 0.07), s(0.5));

  const resultsPoints: LatLng[] = [
    ...mappablePlaces(scenario),
    searchCenter(scenario),
  ];
  const fitResults = zoomToFitPoints(
    resultsPoints,
    run.resultsMap.width,
    run.resultsMap.height,
    56,
  );
  const resultsMap = (f: number): MapView => ({
    center: fitResults.center,
    zoom:
      fitResults.zoom +
      drift(0.25, 0) *
        progress(f, clickAt.mapToggle, beatEnd(tl, "exit") - clickAt.mapToggle, inOutCubic),
    width: run.resultsMap.width,
    height: run.resultsMap.height,
  });

  const agent = (f: number) =>
    progress(f, at(tl, "research", 1.3), s(0.6), glide) *
    (1 - progress(f, beatStart(tl, "results"), s(0.5), inOutCubic));

  // --- sound ----------------------------------------------------------------------
  // A press is heard a hair before the frame it lands on, as a real one is.
  const cues: Cue[] = [
    { frame: 0, sound: "whoosh", volume: 0.7 },
    ...pressAt.map((frame) => ({ frame: frame - s(0.03), sound: "click" as const, volume: 0.9 })),
    { frame: clickAt.sliderDown - s(0.02), sound: "click", volume: 0.6 },
    { frame: radiusDrag.to, sound: "click", volume: 0.5 },
    { frame: clickAt.map + s(0.16), sound: "pop", volume: 0.7 },
    ...keyTimes.map((frame, i) => ({
      frame: frame - s(0.01),
      sound: "key" as const,
      volume: 0.45 + 0.2 * hash01(i + 3),
    })),
    { frame: at(tl, "research", 0.95), sound: "whoosh", volume: 0.5 },
    { frame: within(tl, "research", 0.93), sound: "chime", volume: 0.6 },
    { frame: beatStart(tl, "results"), sound: "whoosh", volume: 0.45 },
    { frame: beatStart(tl, "exit"), sound: "whoosh", volume: 0.55 },
  ];

  return {
    totalFrames,
    page: (f) => (progress(f, swapAt, s(0.35), inOutCubic) < 0.5 ? "form" : "run"),
    pageSwap: (f) => progress(f, swapAt, s(0.35), inOutCubic),
    scroll,
    formScroll,
    runScroll,
    window: (f) => track(f, windowKeys, mixWindow),
    camera: (f) => track(f, cameraKeys, mixCamera),
    cursor,
    clicks,
    form: {
      mapOpen,
      intentRow,
      chipOn,
      located,
      radiusKm,
      slider,
      typed,
      textareaFocus: (f) => progress(f, clickAt.textarea, s(0.15)) * (1 - progress(f, clickAt.submit, s(0.1))),
      intentPulse: (f) => progress(f, within(tl, "requirement", 0.62), s(0.7)),
      submitting: (f) => progress(f, clickAt.submit + s(0.08), s(0.12)),
      map: formMap,
    },
    run: {
      runSeconds,
      done,
      dossier,
      cardIn,
      detail,
      hoverCard: (f) =>
        progress(f, clickAt.card - s(0.45), s(0.25)) * (1 - progress(f, clickAt.card, s(0.3))),
      detailScroll: (f) => progress(f, at(tl, "evidence", 2.6), s(1), dolly),
      highlight,
      mapView,
      pinIn,
      resultsMap,
    },
    agent,
    cues: cues
      .filter((c) => c.frame >= 0 && c.frame < totalFrames)
      .sort((a, b) => a.frame - b.frame),
  };
}

/**
 * The choreography a scenario renders with: its timeline, the form's chips
 * in catalog order, and the ticked requirement's intents. The composition and
 * the asset script both call this, so they cannot disagree about a map move.
 */
export function choreographyFor(
  scenario: Scenario,
  variant: Variant = "video",
): {
  timeline: Timeline;
  chor: Choreography;
  chipIds: string[];
  intentIds: string[];
  intentLabels: string[];
} {
  const timeline = buildTimeline(scenario.timing, scenario.video.fps);
  // Every catalog requirement is a chip, in catalog order — the same list
  // `RequirementChips` renders.
  const chipIds = requirements.map((r) => r.id);
  const requirement = getRequirement(scenario.search.requirement);
  const intentIds = [...(requirement?.intents ?? scenario.search.intents)];
  const intentLabels = intentIds.map(
    (id) => labelOf(getIntent(id), scenario.locale) || id,
  );
  const chor = createChoreography({
    scenario,
    timeline,
    intentLabels,
    chipIndex: Math.max(0, chipIds.indexOf(scenario.search.requirement)),
    frame: { width: scenario.video.width, height: scenario.video.height },
    still: variant === "gif",
  });
  return { timeline, chor, chipIds, intentIds, intentLabels };
}

/** Every map view the walkthrough draws, one per frame — for tile prefetch. */
export function sampleMapViews(chor: Choreography, step = 1): MapView[] {
  const views: MapView[] = [];
  for (let f = 0; f <= chor.totalFrames; f += step) {
    if (chor.form.mapOpen(f) > 0 && chor.page(f) === "form") views.push(chor.form.map(f).view);
    if (chor.run.mapView(f) > 0) views.push(chor.run.resultsMap(f));
  }
  return views;
}
