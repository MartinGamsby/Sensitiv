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
import { requirements, type CatalogRequirement } from "./requirements.ts";

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

/** Turn a selected catalog chip into a PlannedRequirement in the given locale. */
export function toPlannedRequirement(
  catalogId: string,
  locale: UiLocale,
  extras?: { allergens?: readonly string[]; diet?: string },
): PlannedRequirement {
  const requirement = getRequirement(catalogId);
  if (!requirement) {
    // catalogId comes from our own UI chips, not the LLM — a miss is a bug.
    throw new Error(`unknown catalog requirement id: ${catalogId}`);
  }

  const draft: PlannedRequirement = {
    id: requirement.id,
    catalogId: requirement.id,
    label: labelOf(requirement, locale),
    intentIds: [...requirement.intents],
    must: [...requirement.mustHints],
    nice: [...requirement.niceHints],
  };

  const allergens = extras?.allergens?.filter((a) => a.trim() !== "") ?? [];
  if (allergens.length > 0) draft.allergens = [...allergens];
  if (extras?.diet && extras.diet.trim() !== "") draft.diet = extras.diet.trim();

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
): PlannedRequirement {
  const { valid } = validateIntentIds(intentIds);
  const draft: PlannedRequirement = {
    id: `custom_${slugify(userText)}`,
    label: userText.trim() || "Custom requirement",
    intentIds: valid,
    must: [...mustHints],
    nice: [],
  };
  return PlannedRequirementSchema.parse(draft);
}

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
