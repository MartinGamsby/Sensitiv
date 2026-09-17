// The planner: what the user typed + which chips they clicked -> what the agent
// will actually research. Pure logic + exactly one LLM call. No DB, no browser.
//
// Trust model: chip ids come from our own UI and are validated but expected to
// be valid. The LLM output is fully untrusted for control flow — every intent id
// and catalog id it returns is filtered through the catalog allowlist, and an
// unknown id is dropped with a warning, never thrown.

import {
  getRequirement,
  intents,
  intentsForRequirements,
  makeCustomRequirement,
  toPlannedRequirement,
  validateIntentIds,
  validateRequirementIds,
  wantsExtraField,
} from "../../catalog/index.ts";
import { LlmError } from "../llm/index.ts";
import type { LlmProvider } from "../llm/index.ts";
import type { Location } from "../schema/location.ts";
import type { SearchLanguage, UiLocale } from "../schema/language.ts";
import { PlannedRequirementSchema } from "../schema/requirement.ts";
import type { PlannedRequirement } from "../schema/requirement.ts";
import { buildPlannerPrompt } from "./prompt.ts";
import { buildSearchQueries } from "./queries.ts";
import type { SearchQuery } from "./queries.ts";
import { PlannerLlmOutputSchema } from "./schema.ts";
import type { PlannerLlmOutput, PlannerLlmRequirement } from "./schema.ts";

export * from "./prompt.ts";
export * from "./queries.ts";
export * from "./schema.ts";

/** Hint arrays are capped at this many entries so downstream prompts stay bounded. */
export const PLANNER_HINT_CAP = 8;

export type PlannerExtras = {
  allergens?: readonly string[];
  diet?: string;
};

export type PlanArgs = {
  requestText: string;
  /** Catalog requirement ids selected in the UI. `[]` = free-text-only run. */
  chipIds: readonly string[];
  extras?: PlannerExtras;
  location: Location;
  searchLang: SearchLanguage;
  uiLocale: UiLocale;
  provider: LlmProvider;
  signal?: AbortSignal;
};

export type PlanResult = {
  requirements: PlannedRequirement[];
  /** Deduped catalog intent ids, in catalog declaration order. */
  intentIds: string[];
  queries: SearchQuery[];
  /** Dropped ids, LLM failures, empty-plan fallback, etc. Never fatal. */
  warnings: string[];
};

// ---------------------------------------------------------------------------

export async function plan(args: PlanArgs): Promise<PlanResult> {
  const warnings: string[] = [];
  const order: string[] = [];
  const byId = new Map<string, PlannedRequirement>();

  const addOrMerge = (
    incoming: PlannedRequirement,
    // Set when `incoming.intentIds` is the model's own reading of the request
    // rather than the catalog default. The chip was added first, carrying every
    // intent the catalog allows, so unioning here would undo the narrowing the
    // model just did — which is how a request for an Italian restaurant kept
    // its `grocery` intent all the way to the search.
    opts: { replaceIntents?: boolean } = {},
  ): void => {
    const existing = byId.get(incoming.id);
    if (!existing) {
      byId.set(incoming.id, incoming);
      order.push(incoming.id);
      return;
    }
    existing.must = capHints([], existing.must, incoming.must);
    existing.nice = capHints([], existing.nice, incoming.nice);
    existing.intentIds = opts.replaceIntents
      ? dedupe(incoming.intentIds)
      : dedupe([...existing.intentIds, ...incoming.intentIds]);
    if (incoming.allergens && incoming.allergens.length > 0) {
      existing.allergens = dedupe([...(existing.allergens ?? []), ...incoming.allergens]);
    }
    if (incoming.diet && !existing.diet) existing.diet = incoming.diet;
    if (incoming.catalogId && !existing.catalogId) existing.catalogId = incoming.catalogId;
  };

  // 1. Chips first, deterministically. This path never needs the model.
  const chipCheck = validateRequirementIds(args.chipIds);
  for (const unknown of chipCheck.unknown) warnings.push(`dropped_unknown_chip:${unknown}`);
  const extras = normalizeExtras(args.extras);
  for (const chipId of chipCheck.valid) {
    addOrMerge(toPlannedRequirement(chipId, args.uiLocale, extras));
  }

  // 2. LLM only when there is free text to interpret.
  const requestText = args.requestText.trim();
  if (requestText !== "") {
    const raw = await runPlannerLlm(args, requestText, warnings);
    if (raw) {
      for (const llmReq of raw.requirements) {
        mergeLlmRequirement(llmReq, { addOrMerge, extras, uiLocale: args.uiLocale, warnings });
      }
    }
  }

  // 3 + 4. Collect merged requirements in first-seen order.
  let requirements: PlannedRequirement[] = [];
  for (const id of order) {
    const req = byId.get(id);
    if (req) requirements.push(req);
  }

  // 6. Empty-plan fallback: a thin dossier beats an error.
  if (requirements.length === 0) {
    warnings.push("planner_empty_fallback");
    requirements = [makeCustomRequirement("", ["dining"], [])];
  }

  // Final normalization + revalidation against the schema.
  requirements = requirements.map((req) =>
    PlannedRequirementSchema.parse({
      ...req,
      must: capHints([], req.must),
      nice: capHints([], req.nice),
      intentIds: dedupe(req.intentIds),
    }),
  );

  // 5. Intents = union of every requirement's intentIds and the intents the
  //    catalog activates for them, deduped in catalog declaration order.
  const intentIds = orderedIntentIds(requirements);

  // 7. Search queries in the resolved search language.
  const queries = buildSearchQueries({
    intentIds,
    requirements,
    location: args.location,
    searchLang: args.searchLang,
  });

  return { requirements, intentIds, queries, warnings };
}

// ---------------------------------------------------------------------------

async function runPlannerLlm(
  args: PlanArgs,
  requestText: string,
  warnings: string[],
): Promise<PlannerLlmOutput | undefined> {
  const { system, user } = buildPlannerPrompt({
    requestText,
    chipIds: args.chipIds,
    location: args.location,
    searchLang: args.searchLang,
    uiLocale: args.uiLocale,
  });

  try {
    return await args.provider.completeStructured({
      system,
      user,
      schema: PlannerLlmOutputSchema,
      temperature: 0,
      signal: args.signal,
    });
  } catch (err) {
    // An abort is the caller's job timeout — let it propagate.
    if (err instanceof LlmError && err.kind === "abort") throw err;
    if (err instanceof Error && err.name === "AbortError") throw err;
    const tag = err instanceof LlmError ? (err.kind ?? "error") : "error";
    warnings.push(`planner_llm_failed:${tag}`);
    return undefined;
  }
}

type MergeCtx = {
  addOrMerge: (
    req: PlannedRequirement,
    opts?: { replaceIntents?: boolean },
  ) => void;
  extras: { allergens?: string[]; diet?: string } | undefined;
  uiLocale: UiLocale;
  warnings: string[];
};

function mergeLlmRequirement(llmReq: PlannerLlmRequirement, ctx: MergeCtx): void {
  const intentCheck = validateIntentIds(llmReq.intentIds);
  for (const unknown of intentCheck.unknown) {
    ctx.warnings.push(`dropped_unknown_intent:${unknown}`);
  }

  const must = llmReq.must;
  const nice = llmReq.nice;
  const catalogId =
    llmReq.catalogId && getRequirement(llmReq.catalogId) ? llmReq.catalogId : undefined;
  if (llmReq.catalogId && !catalogId) {
    ctx.warnings.push(`dropped_unknown_requirement:${llmReq.catalogId}`);
  }

  if (catalogId) {
    const requirement = getRequirement(catalogId);
    const base = toPlannedRequirement(catalogId, ctx.uiLocale, ctx.extras);
    base.must = capHints([], base.must, must);
    base.nice = capHints([], base.nice, nice);
    // The planner NARROWS, it does not only add.
    //
    // `toPlannedRequirement` seeds every intent the catalog says this
    // requirement CAN activate, and this line used to union the model's on top
    // — so the model could add an intent but never drop one. Celiac declares
    // `dining` and `grocery`, so a request for an Italian restaurant searched
    // for gluten-free grocery stores too, and half the run's budget went on
    // "sans gluten épicerie". The catalog lists what is possible; the model has
    // actually read the request, so when it names valid intents they win.
    // Nothing valid from the model leaves the catalog's list untouched.
    const narrowed = intentCheck.valid.length > 0;
    base.intentIds = narrowed ? dedupe(intentCheck.valid) : base.intentIds;
    // Same rule as `toPlannedRequirement`: a sub-picker value only sticks to a
    // requirement that declares the field, however insistent the model is.
    if (
      wantsExtraField(requirement, "allergens") &&
      llmReq.allergens &&
      llmReq.allergens.length > 0
    ) {
      base.allergens = dedupe([...(base.allergens ?? []), ...llmReq.allergens]);
    }
    if (wantsExtraField(requirement, "diet") && llmReq.diet && !base.diet) {
      base.diet = llmReq.diet;
    }
    ctx.addOrMerge(base, { replaceIntents: narrowed });
    return;
  }

  // Custom free-text requirement. A requirement with zero valid intents is
  // useless (nowhere to look) — drop it with a warning rather than keep it.
  if (intentCheck.valid.length === 0) {
    ctx.warnings.push(`dropped_requirement_no_intents:${slugLabel(llmReq.label)}`);
    return;
  }
  const custom = makeCustomRequirement(llmReq.label, intentCheck.valid, must);
  custom.nice = capHints([], custom.nice, nice);
  if (llmReq.allergens && llmReq.allergens.length > 0) {
    custom.allergens = dedupe([...llmReq.allergens]);
  }
  if (llmReq.diet) custom.diet = llmReq.diet;
  ctx.addOrMerge(custom);
}

// ---------------------------------------------------------------------------

function orderedIntentIds(requirements: readonly PlannedRequirement[]): string[] {
  const wanted = new Set<string>();
  for (const req of requirements) {
    for (const intentId of req.intentIds) wanted.add(intentId);
  }
  // Deliberately NOT re-adding `intentsForRequirements(...)` here. Every
  // planned requirement already carries its intents — the catalog's full list
  // by default, or the narrower set the model chose after reading the request
  // (see `mergeLlmRequirement`). Folding the catalog's list back in undid that
  // narrowing, which is how a search for an Italian restaurant kept its
  // `grocery` intent and spent half the run on "sans gluten épicerie".
  if (wanted.size === 0) {
    for (const intentId of intentsForRequirements(requirements.map((r) => r.id))) {
      wanted.add(intentId);
    }
  }
  // `intents` is the catalog order and only contains valid ids — this is also
  // the last filter that drops any intent id that is not in the catalog.
  return intents.filter((intent) => wanted.has(intent.id)).map((intent) => intent.id);
}

function dedupe(items: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const trimmed = item.trim();
    if (trimmed === "" || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function capHints(...groups: readonly string[][]): string[] {
  const merged: string[] = [];
  for (const group of groups) merged.push(...group);
  return dedupe(merged).slice(0, PLANNER_HINT_CAP);
}

function normalizeExtras(
  extras: PlannerExtras | undefined,
): { allergens?: string[]; diet?: string } | undefined {
  if (!extras) return undefined;
  const out: { allergens?: string[]; diet?: string } = {};
  const allergens = (extras.allergens ?? [])
    .map((a) => a.trim())
    .filter((a) => a !== "");
  if (allergens.length > 0) out.allergens = allergens;
  if (extras.diet && extras.diet.trim() !== "") out.diet = extras.diet.trim();
  return out.allergens || out.diet ? out : undefined;
}

/** A short, safe rendering of an LLM label for a warning string. */
function slugLabel(label: string): string {
  return label.trim().replace(/\s+/g, " ").slice(0, 40);
}
