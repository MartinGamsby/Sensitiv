// Geometry of the two app pages the video recreates, in the app's own CSS
// pixels (a 1280×720 browser viewport). The page components position their
// blocks from these numbers and the cursor and camera aim at them, so a click
// always lands on the thing it is clicking.
//
// The measurements follow the real Tailwind classes (`max-w-5xl`, `p-6`,
// `gap-6`, `h-11`, …) — see the comments beside each block for the class it
// stands in for.

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function center(rect: Rect): { x: number; y: number } {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

export function rect(x: number, y: number, width: number, height: number): Rect {
  return { x, y, width, height };
}

/** The browser viewport the app renders into. */
export const VIEWPORT = { width: 1280, height: 720 } as const;
/** `SiteHeader`: `h-16`, sticky. */
export const HEADER_H = 64;
/** `<main>`: `max-w-5xl px-6` centred → 976px of content. */
export const COLUMN = { x: 152, width: 976 } as const;
/** `RunView`: `xl:-mx-16` widens the run page by 64px a side. */
export const WIDE_COLUMN = { x: 88, width: 1104 } as const;
/** `<main>`: `sm:py-12`. */
export const MAIN_TOP = HEADER_H + 48;

const CARD_PAD = 24; // Card padding="lg" → sm:p-6
const GAP = 24; // form gap-6
const INNER_X = COLUMN.x + CARD_PAD;
const INNER_W = COLUMN.width - 2 * CARD_PAD;

/** The map panel: `minHeight: 18rem` + `gap-2` + one line of hint. */
export const MAP_H = 288;
const MAP_BLOCK = 12 + MAP_H + 8 + 16; // gap-3 above, then map, gap-2, hint

/** The intent picker row under the chips ("Look for this in: …"). */
const HINT_ROW_H = 16;
const INTENT_ROW_H = 26;

export interface FormState {
  /** 0 = map panel closed, 1 = fully open. Animated. */
  mapOpen: number;
  /** 0 = the chips' hint line, 1 = the intent picker row. Animated. */
  intentRow: number;
}

export interface FormLayout {
  pageHeight: number;
  title: Rect;
  subtitle: Rect;
  card1: Rect;
  heading1: Rect;
  locationLabel: Rect;
  locationInput: Rect;
  useMyLocation: Rect;
  radiusLabel: Rect;
  radiusSlider: Rect;
  radiusInput: Rect;
  radiusUnit: Rect;
  radiusHint: Rect;
  divider: number;
  mapButton: Rect;
  postalLink: Rect;
  map: Rect;
  mapHint: Rect;
  card2: Rect;
  heading2: Rect;
  description2: Rect;
  /** Five chips, in `CHIP_IDS` order. */
  chips: Rect[];
  chipRow: Rect;
  /** Intent pills, in the requirement's catalog order. */
  intentLabel: Rect;
  card3: Rect;
  heading3: Rect;
  description3: Rect;
  requestLabel: Rect;
  textarea: Rect;
  examplesLabel: Rect;
  presets: Rect[];
  advanced: Rect;
  submitCard: Rect;
  submitButton: Rect;
  footer: Rect;
}

/** Width of an intent pill for a label — `px-2.5 text-xs font-medium`. */
export function pillWidth(label: string): number {
  return Math.round(label.length * 6.6 + 22);
}

export function formLayout(state: FormState): FormLayout {
  const mapBlock = MAP_BLOCK * state.mapOpen;
  const title = rect(COLUMN.x, MAIN_TOP, COLUMN.width, 36); // text-3xl
  const subtitle = rect(COLUMN.x, MAIN_TOP + 44, 672, 52); // mt-2, max-w-2xl, 2 lines

  // --- card 1: where --------------------------------------------------------
  const card1Y = MAIN_TOP + 96 + GAP;
  const heading1 = rect(INNER_X, card1Y + 24, INNER_W, 28);
  const locationLabel = rect(INNER_X, card1Y + 68, INNER_W, 14);
  const buttonW = 172;
  const locationInput = rect(INNER_X, card1Y + 88, INNER_W - buttonW - 8, 44);
  const useMyLocation = rect(INNER_X + INNER_W - buttonW, card1Y + 88, buttonW, 44);
  const radiusY = card1Y + 144;
  const radiusLabel = rect(INNER_X, radiusY, 98, 40);
  const radiusUnit = rect(INNER_X + INNER_W - 20, radiusY, 20, 40);
  const radiusInput = rect(radiusUnit.x - 12 - 76, radiusY, 76, 40);
  const sliderX = radiusLabel.x + radiusLabel.width + 12;
  const radiusSlider = rect(sliderX, radiusY, radiusInput.x - 12 - sliderX, 40);
  const radiusHint = rect(INNER_X, card1Y + 190, INNER_W, 16);
  const divider = card1Y + 218;
  const mapButton = rect(INNER_X, card1Y + 231, 192, 36);
  const postalLink = rect(INNER_X + INNER_W - 92, card1Y + 235, 92, 28);
  const map = rect(INNER_X, card1Y + 279, INNER_W, MAP_H);
  const mapHint = rect(INNER_X + 4, card1Y + 279 + MAP_H + 8, INNER_W, 16);
  const card1 = rect(COLUMN.x, card1Y, COLUMN.width, 291 + mapBlock);

  // --- card 2: what has to be true ------------------------------------------
  const card2Y = card1.y + card1.height + GAP;
  const heading2 = rect(INNER_X, card2Y + 24, INNER_W, 28);
  const description2 = rect(INNER_X, card2Y + 58, INNER_W, 23);
  const chipW = (INNER_W - 16) / 3; // grid-cols-3 gap-2
  const chips: Rect[] = [0, 1, 2, 3, 4].map((i) =>
    rect(
      INNER_X + (i % 3) * (chipW + 8),
      card2Y + 97 + Math.floor(i / 3) * (46 + 8),
      chipW,
      46,
    ),
  );
  const rowH = HINT_ROW_H + (INTENT_ROW_H - HINT_ROW_H) * state.intentRow;
  const chipRow = rect(INNER_X, card2Y + 209, INNER_W, INTENT_ROW_H);
  const intentLabel = rect(INNER_X + 4, card2Y + 209, 104, INTENT_ROW_H);
  const card2 = rect(COLUMN.x, card2Y, COLUMN.width, 209 + rowH + CARD_PAD);

  // --- card 3: anything specific --------------------------------------------
  const card3Y = card2.y + card2.height + GAP;
  const heading3 = rect(INNER_X, card3Y + 24, INNER_W, 28);
  const description3 = rect(INNER_X, card3Y + 58, INNER_W, 23);
  const requestLabel = rect(INNER_X, card3Y + 97, INNER_W, 14);
  const textarea = rect(INNER_X, card3Y + 117, INNER_W, 90); // rows=3
  const examplesLabel = rect(INNER_X, card3Y + 223, INNER_W, 16);
  const presetW = (INNER_W - 8) / 2;
  const presets: Rect[] = [0, 1, 2, 3].map((i) =>
    rect(
      INNER_X + (i % 2) * (presetW + 8),
      card3Y + 247 + Math.floor(i / 2) * (63 + 8),
      presetW,
      63,
    ),
  );
  const card3 = rect(COLUMN.x, card3Y, COLUMN.width, 405);

  // --- advanced + submit ------------------------------------------------------
  const advanced = rect(COLUMN.x, card3.y + card3.height + GAP, COLUMN.width, 36);
  const submitY = advanced.y + advanced.height + GAP;
  const submitCard = rect(COLUMN.x, submitY, COLUMN.width, 164);
  const submitButton = rect(INNER_X + INNER_W - 190, submitY + 58, 190, 48); // size lg
  const footer = rect(0, submitCard.y + submitCard.height + 32, VIEWPORT.width, 72);

  return {
    pageHeight: footer.y + footer.height,
    title,
    subtitle,
    card1,
    heading1,
    locationLabel,
    locationInput,
    useMyLocation,
    radiusLabel,
    radiusSlider,
    radiusInput,
    radiusUnit,
    radiusHint,
    divider,
    mapButton,
    postalLink,
    map,
    mapHint,
    card2,
    heading2,
    description2,
    chips,
    chipRow,
    intentLabel,
    card3,
    heading3,
    description3,
    requestLabel,
    textarea,
    examplesLabel,
    presets,
    advanced,
    submitCard,
    submitButton,
    footer,
  };
}

/** The intent pills' boxes, laid out left to right after the row's label. */
export function intentPills(
  layout: FormLayout,
  labels: readonly string[],
): Rect[] {
  let x = layout.intentLabel.x + layout.intentLabel.width + 8;
  return labels.map((label) => {
    const w = pillWidth(label);
    const r = rect(x, layout.chipRow.y, w, INTENT_ROW_H);
    x += w + 8;
    return r;
  });
}

// --- the run page ------------------------------------------------------------

/** `DossierPlaceCard` in the three-column grid: a two-line name or two rows
 *  of requirement pills still fit. */
export const CARD_H = 168;
const GRID_GAP_X = 16; // gap-x-4
const GRID_GAP_Y = 32; // gap-y-8
export const GRID_COLS = 3;

export interface RunLayout {
  /** The dossier's warning strips (sample data, unavailable sources). */
  notices: Rect[];
  title: Rect;
  badges: Rect;
  meta: Rect;
  newSearch: Rect;
  /** The status card, open (while running) — `p-4 pb-2` + progress. */
  statusOpen: Rect;
  /** The status card folded to one line once the run is done. */
  statusClosed: Rect;
  placeholder: Rect;
  dossierHeading: Rect;
  dossierSummary: Rect;
  disclaimer: Rect;
  sortRow: Rect;
  viewSwitch: Rect;
  listToggle: Rect;
  mapToggle: Rect;
  gridTop: number;
  /** Card `i` (0-based rank) in list view. */
  card: (index: number) => Rect;
  /** Map view: the map on the left, a single column of cards on the right. */
  resultsMap: Rect;
  mapCard: (index: number) => Rect;
}

/** `notices`: how many warning strips the dossier shows above its results. */
export function runLayout(notices = 0): RunLayout {
  const x = WIDE_COLUMN.x;
  const w = WIDE_COLUMN.width;
  const NOTICE_H = 56;
  const shift = notices * (NOTICE_H + 16);
  const title = rect(x, MAIN_TOP, w - 120, 32); // text-2xl
  const badges = rect(x, MAIN_TOP + 44, w, 20);
  const meta = rect(x, MAIN_TOP + 76, w, 16);
  const newSearch = rect(x + w - 96, MAIN_TOP, 108, 32);
  const statusY = MAIN_TOP + 116;
  const statusOpen = rect(x, statusY, w, 136);
  const statusClosed = rect(x, statusY, w, 42);
  const placeholder = rect(x, statusOpen.y + statusOpen.height + 24, w, 384);

  const dossierY = statusClosed.y + statusClosed.height + 24;
  const dossierHeading = rect(x, dossierY, w, 28);
  const dossierSummary = rect(x, dossierY + 34, w, 22);
  const noticeRects = Array.from({ length: notices }, (_, i) =>
    rect(x, dossierY + 72 + i * (NOTICE_H + 16), w, NOTICE_H),
  );
  const disclaimer = rect(x + 4, dossierY + 72 + shift, w, 20);
  const sortRow = rect(x, dossierY + 108 + shift, w, 32);
  const viewSwitch = rect(x + w - 330, sortRow.y, 128, 32);
  const listToggle = rect(viewSwitch.x + 3, sortRow.y + 3, 58, 26);
  const mapToggle = rect(viewSwitch.x + 64, sortRow.y + 3, 60, 26);
  const gridTop = sortRow.y + sortRow.height + 16 + 28; // gap-4, then pt-7
  const colW = (w - GRID_GAP_X * (GRID_COLS - 1)) / GRID_COLS;
  const card = (index: number) =>
    rect(
      x + (index % GRID_COLS) * (colW + GRID_GAP_X),
      gridTop + Math.floor(index / GRID_COLS) * (CARD_H + GRID_GAP_Y),
      colW,
      CARD_H,
    );

  // `lg:grid-cols-[minmax(0,1fr)_23rem]`, map `h-[calc(100vh-7rem)]`.
  const sideW = 368;
  const resultsMap = rect(x, sortRow.y + sortRow.height + 16, w - sideW - 16, 608);
  const mapCard = (index: number) =>
    rect(x + w - sideW, gridTop + index * (CARD_H + GRID_GAP_Y), sideW, CARD_H);

  return {
    notices: noticeRects,
    title,
    badges,
    meta,
    newSearch,
    statusOpen,
    statusClosed,
    placeholder,
    dossierHeading,
    dossierSummary,
    disclaimer,
    sortRow,
    viewSwitch,
    listToggle,
    mapToggle,
    gridTop,
    card,
    resultsMap,
    mapCard,
  };
}

/** The place-detail overlay — `max-w-2xl`, centred, near the top. */
export const DETAIL = rect((VIEWPORT.width - 672) / 2, 28, 672, 664);

/**
 * Slider travel for a radius. Mirrors `kmToSlider` in the web app's
 * `radius-field.tsx`: a square curve over 0.5–100 km, so 1–10 km gets the
 * first third of the track.
 */
export function sliderFraction(km: number, minKm: number, maxKm: number): number {
  const t = Math.sqrt(Math.min(1, Math.max(0, (km - minKm) / (maxKm - minKm))));
  return Math.round(t * 500) / 500;
}

/** The slider's inverse, rounded to the 0.5 km step the form commits. */
export function sliderKm(fraction: number, minKm: number, maxKm: number): number {
  const t = Math.min(1, Math.max(0, fraction));
  const km = minKm + (maxKm - minKm) * t * t;
  return Math.round(Math.min(maxKm, Math.max(minKm, km)) * 2) / 2;
}
