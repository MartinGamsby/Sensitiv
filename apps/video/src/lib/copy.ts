import { getRequirement, labelOf } from "@sensitiv/shared/catalog/index";
import type { Scenario } from "../config/scenario.ts";

// The scenario's sentences, with their {placeholders} filled from the run and
// *asterisks* turned into accent colour.

export interface Segment {
  text: string;
  accent: boolean;
}

/** `{name}` → `vars.name`. Unknown names are left in place, visibly. */
export function fillTemplate(text: string, vars: Readonly<Record<string, string>>): string {
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => vars[name] ?? whole);
}

/** Splits `plain *accented* plain` into segments. An unpaired `*` stays literal. */
export function parseEmphasis(text: string): Segment[] {
  const segments: Segment[] = [];
  const re = /\*([^*]+)\*/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) segments.push({ text: text.slice(last, m.index), accent: false });
    segments.push({ text: m[1]!, accent: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) segments.push({ text: text.slice(last), accent: false });
  return segments;
}

/** `google_maps` → `Google Maps`. Mirrors `sourceLabel` in the web app. */
const SOURCE_LABELS: Readonly<Record<string, string>> = {
  google_maps: "Google Maps",
  openstreetmap: "OpenStreetMap",
};

export function sourceLabel(id: string): string {
  const known = SOURCE_LABELS[id];
  if (known) return known;
  const words = id.replace(/[_-]+/g, " ").trim();
  return words === "" ? id : words.charAt(0).toUpperCase() + words.slice(1);
}

/** `custom_mexican_restaurant` → `Mexican restaurant`, as the dossier shows it. */
export function humanizeRequirementId(id: string): string {
  const words = id.replace(/^custom[_-]/, "").replace(/[_-]+/g, " ").trim();
  if (words === "") return id;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function requirementLabel(id: string, locale: "en" | "fr"): string {
  return labelOf(getRequirement(id), locale) || humanizeRequirementId(id);
}

/** `m:ss`, like the run page's "Took 2:09". */
export function formatElapsed(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function joinList(items: readonly string[], locale: "en" | "fr"): string {
  try {
    return new Intl.ListFormat(locale, { type: "conjunction" }).format(items);
  } catch {
    return items.join(", ");
  }
}

/** Every placeholder a scenario's copy may use, filled from its own run. */
export function copyVars(scenario: Scenario): Record<string, string> {
  const run = scenario.run;
  const sources = Object.entries(run.sourceModes)
    .filter(([id, mode]) => id !== "llm" && mode === "live")
    .map(([id]) => sourceLabel(id));
  return {
    places: String(run.places.length),
    evidence: String(run.places.reduce((n, p) => n + p.evidence.length, 0)),
    radius: String(scenario.search.radiusKm),
    pin: scenario.search.pin.label,
    request: scenario.search.request,
    requirement: requirementLabel(scenario.search.requirement, scenario.locale),
    location: scenario.search.locationText,
    sources: joinList(sources, scenario.locale),
    duration: formatElapsed(run.durationSec),
  };
}
