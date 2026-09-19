// Config-driven catalog: the single source of truth for what Sensitiv can look
// for (requirements) and where (intents). Everything here is pure data + pure
// functions — no I/O, no LLM, no DB.
//
// Hard rule for the rest of the codebase: never hardcode an intent or
// requirement `kind` union. Call these helpers instead. They FAIL CLOSED on
// unknown ids (drop + report) and never throw on LLM-invented ids.

import { PlannedRequirementSchema } from "../src/schema/index.ts";
import type { PlannedRequirement, UiLocale } from "../src/schema/index.ts";
import { intents, type Intent } from "./intents.ts";
import {
  DEFAULT_REQUIREMENT_WEIGHT,
  SUBJECT_REQUIREMENT_WEIGHT,
  requirements,
  type CatalogRequirement,
} from "./requirements.ts";

export * from "./intents.ts";
export * from "./requirements.ts";

/** Anything with an id and a per-locale label — an Intent, CatalogRequirement or option. */
export type LabeledEntry = { id: string; label: Record<UiLocale, string> };

/** Result of checking a batch of ids against the catalog. */
export interface IdValidation {
  /** ids that exist in the catalog, in the order supplied. */
  valid: string[];
  /** ids that do not exist — callers should log these. */
  unknown: string[];
}

// ---------------------------------------------------------------------------
// Point lookups
// ---------------------------------------------------------------------------

export function getIntent(id: string): Intent | undefined {
  return intents.find((intent) => intent.id === id);
}

export function getRequirement(id: string): CatalogRequirement | undefined {
  return requirements.find((requirement) => requirement.id === id);
}

export function isValidIntentId(id: string): boolean {
  return intents.some((intent) => intent.id === id);
}

export function isValidRequirementId(id: string): boolean {
  return requirements.some((requirement) => requirement.id === id);
}

// ---------------------------------------------------------------------------
// Batch validation — the "second channel" callers use to log what was dropped.
// ---------------------------------------------------------------------------

export function validateIntentIds(ids: readonly string[]): IdValidation {
  return partitionIds(ids, isValidIntentId);
}

export function validateRequirementIds(ids: readonly string[]): IdValidation {
  return partitionIds(ids, isValidRequirementId);
}

function partitionIds(ids: readonly string[], isValid: (id: string) => boolean): IdValidation {
  const valid: string[] = [];
  const unknown: string[] = [];
  for (const id of ids) {
    if (isValid(id)) valid.push(id);
    else unknown.push(id);
  }
  return { valid, unknown };
}

// ---------------------------------------------------------------------------
// Derivations — always returned in catalog declaration order for reproducible
// tests, never in Set-iteration or caller-supplied order. Unknown ids are
// silently dropped here; use validate*Ids above to find out what was dropped.
// ---------------------------------------------------------------------------

/** Deduped intent ids activated by the given requirements, in catalog order. */
export function intentsForRequirements(requirementIds: readonly string[]): string[] {
  const wanted = new Set<string>();
  for (const requirementId of requirementIds) {
    const requirement = getRequirement(requirementId);
    if (!requirement) continue;
    for (const intentId of requirement.intents) wanted.add(intentId);
  }
  return intents.filter((intent) => wanted.has(intent.id)).map((intent) => intent.id);
}

/** Union of adapter ids for the given intents, deduped, in catalog order. */
export function adapterIdsFor(intentIds: readonly string[]): string[] {
  const wanted = new Set(intentIds);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const intent of intents) {
    if (!wanted.has(intent.id)) continue;
    for (const adapter of intent.adapters) {
      if (seen.has(adapter)) continue;
      seen.add(adapter);
      out.push(adapter);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

/** Locale label for an entry. Falls back to `en`, then to the entry id. Never undefined. */
export function labelOf(entry: LabeledEntry | undefined, locale: UiLocale): string {
  if (!entry) return "";
  const byLocale = entry.label[locale] as string | undefined;
  return byLocale ?? entry.label.en ?? entry.id;
}

// ---------------------------------------------------------------------------
// PlannedRequirement builders
// ---------------------------------------------------------------------------

/** True when a requirement opts into a sub-picker (`allergens` / `diet`). */
export function wantsExtraField(
  requirement: CatalogRequirement | undefined,
  field: string,
): boolean {
  return requirement?.extraFields?.includes(field) ?? false;
}

/**
 * Which of a chip's intents a run searches when the user has not said.
 *
 * The FIRST one, not all of them — and that one-word difference is the whole
 * "why is it still looking for grocery stores" bug. `celiac` declares
 * `["dining", "grocery"]`, which is the list of places the chip CAN apply to,
 * and that list was being read as an instruction to search every one of them.
 * So a celiac run for "Mexican restaurant" issued `gluten free Mexican
 * restaurant` AND `gluten free grocery store`, spent half its budget on the
 * second, and put a grocery store and a pastry shop in the top three.
 *
 * The planner was supposed to narrow this. It never could: the narrowing in
 * `mergeLlmRequirement` only runs when the model re-lists a chip requirement,
 * and the planner prompt tells the model in as many words NOT to re-list a
 * chip. The path was unreachable from the day it was written.
 *
 * So the intent is not inferred any more — it is the user's, picked in the
 * chip's own sub-control, and this is only the value that control starts on.
 * A requirement declaring a single intent is unaffected.
 */
export function defaultIntentsFor(catalogId: string): string[] {
  const requirement = getRequirement(catalogId);
  if (!requirement || requirement.intents.length === 0) return [];
  return [requirement.intents[0] as string];
}

/**
 * Turn a selected catalog chip into a PlannedRequirement in the given locale.
 *
 * `intentIds` is where the user said to look. Values outside the chip's own
 * catalog `intents` are dropped (fail closed, as everywhere else here), and an
 * empty or absent list falls back to `defaultIntentsFor` — NOT to every intent
 * the chip declares.
 */
export function toPlannedRequirement(
  catalogId: string,
  locale: UiLocale,
  extras?: { allergens?: readonly string[]; diet?: string },
  intentIds?: readonly string[],
): PlannedRequirement {
  const requirement = getRequirement(catalogId);
  if (!requirement) {
    // catalogId comes from our own UI chips, not the LLM — a miss is a bug.
    throw new Error(`unknown catalog requirement id: ${catalogId}`);
  }

  const allowed = new Set(requirement.intents);
  const chosen = (intentIds ?? []).filter((id) => allowed.has(id));
  const draft: PlannedRequirement = {
    id: requirement.id,
    catalogId: requirement.id,
    label: labelOf(requirement, locale),
    intentIds:
      chosen.length > 0
        ? requirement.intents.filter((id) => chosen.includes(id))
        : defaultIntentsFor(catalogId),
    must: [...requirement.mustHints],
    nice: [...requirement.niceHints],
    // Carried, never re-derived downstream: scoring and the extraction prompt
    // both read these off the PLANNED requirement, so the catalog stays the one
    // place a weight or a "this already satisfies the must" rule is written.
    weight: requirement.weight,
    satisfiedBy: [...requirement.satisfiedByHints],
    // A chip is always a property the place must have, never the kind of place
    // itself — "celiac" is not a category of restaurant. Only the planner's
    // free-text requirements can be a `subject`.
    kind: "preference",
  };

  // Sub-picker values belong ONLY to the requirement that declares the field.
  // Callers pass one `extras` bag for the whole form, so without this gate a
  // Celiac + Allergy run would stamp the allergen list onto `celiac` too.
  const allergens = wantsExtraField(requirement, "allergens")
    ? (extras?.allergens?.filter((a) => a.trim() !== "") ?? [])
    : [];
  if (allergens.length > 0) draft.allergens = [...allergens];
  if (
    wantsExtraField(requirement, "diet") &&
    extras?.diet &&
    extras.diet.trim() !== ""
  ) {
    draft.diet = extras.diet.trim();
  }

  return PlannedRequirementSchema.parse(draft);
}

/**
 * Build an ad-hoc requirement the planner invented from free text.
 * id = `custom_<slug>` where slug is: lowercased, accents stripped,
 * non-alphanumerics -> `_`, repeats collapsed, trimmed, capped at 40 chars.
 * Empty slug -> `custom_request`. Unknown intent ids are dropped (fail closed).
 */
export function makeCustomRequirement(
  userText: string,
  intentIds: readonly string[],
  mustHints: readonly string[],
  kind: "subject" | "preference" = "preference",
  categoryHints?: { strong?: string[]; related?: string[]; excluded?: string[] },
): PlannedRequirement {
  const { valid } = validateIntentIds(intentIds);
  const draft: PlannedRequirement = {
    id: `custom_${slugify(userText)}`,
    label: userText.trim() || "Custom requirement",
    intentIds: valid,
    must: [...mustHints],
    nice: [],
    // Free text the planner turned into a requirement. A PREFERENCE ("open
    // late", "has a patio") is the lowest tier on purpose — the user typed it
    // as a wish. A SUBJECT ("Mexican restaurant") is not a wish at all, it is
    // the thing being searched for, and it carries a chip's weight.
    weight:
      kind === "subject" ? SUBJECT_REQUIREMENT_WEIGHT : DEFAULT_REQUIREMENT_WEIGHT,
    satisfiedBy: [],
    kind,
  };
  // Only a subject is judged against a place's category, so hints on anything
  // else would be dead weight in every prompt and every stored row.
  if (kind === "subject" && categoryHints) {
    draft.categoryHints = {
      strong: dedupeTerms(categoryHints.strong),
      related: dedupeTerms(categoryHints.related),
      excluded: dedupeTerms(categoryHints.excluded),
    };
  }
  return PlannedRequirementSchema.parse(draft);
}

/** Lowercased, trimmed, deduped, and capped — these come from an LLM and end up
 *  in a stored row, so they are bounded like every other planner output. */
function dedupeTerms(terms: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  for (const term of terms ?? []) {
    const trimmed = term.trim().toLowerCase();
    if (trimmed !== "") seen.add(trimmed);
  }
  return [...seen].slice(0, CATEGORY_HINT_CAP);
}

/** Per grade. Enough to describe a cuisine, few enough that a stored
 *  requirement stays readable. */
export const CATEGORY_HINT_CAP = 12;

export function slugify(input: string): string {
  let slug = input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip combining accent marks
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (slug.length > 40) slug = slug.slice(0, 40).replace(/_+$/g, "");
  return slug || "request";
}

// ---------------------------------------------------------------------------
// Planner prompt
// ---------------------------------------------------------------------------

/**
 * Compact catalog listing for the planner system prompt. Contains every intent
 * id and every requirement id so the prompt can never silently drift from the
 * catalog (guarded by a test).
 */
export function catalogPromptSummary(locale: UiLocale): string {
  const intentLines = intents.map(
    (intent) =>
      `- ${intent.id} — ${labelOf(intent, locale)} (adapters: ${intent.adapters.join(", ")})`,
  );
  const requirementLines = requirements.map(
    (requirement) =>
      `- ${requirement.id} — ${labelOf(requirement, locale)} (intents: ${requirement.intents.join(", ")})`,
  );
  return [
    "INTENTS (where to look):",
    ...intentLines,
    "",
    "REQUIREMENTS (constraints, may add custom_<slug>):",
    ...requirementLines,
  ].join("\n");
}
