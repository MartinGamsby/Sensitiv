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
  /**
   * Per chip, the intents the user chose in the form. An absent entry falls
   * back to `defaultIntentsFor` — the chip's first intent, not all of them.
   *
   * When any chip is present these intents BOUND the run: the model may pick
   * among them but may not add to them. "Where to look" is a question the form
   * asks in plain words, and an answer the user gave beats an answer inferred
   * from free text.
   */
  chipIntents?: Readonly<Record<string, readonly string[]>>;
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
    // `subject` is an upgrade, never a downgrade: if either reading says this
    // is the kind of place being searched for, it is. The weight follows, and
    // only ever upwards — merging must not cheapen a chip.
    if (incoming.kind === "subject") {
      existing.kind = "subject";
      existing.weight = Math.max(existing.weight, incoming.weight);
    }
  };

  // 1. Chips first, deterministically. This path never needs the model.
  const chipCheck = validateRequirementIds(args.chipIds);
  for (const unknown of chipCheck.unknown) warnings.push(`dropped_unknown_chip:${unknown}`);
  const extras = normalizeExtras(args.extras);
  // Where the user said to look, per chip, after defaults are applied. Recorded
  // separately because it OVERRIDES the model: a chip's intents are an answer
  // the user gave in the form, and the model re-reading the free text is not
  // grounds to change it in either direction.
  const chipIntents: Record<string, string[]> = {};
  for (const chipId of chipCheck.valid) {
    const planned = toPlannedRequirement(
      chipId,
      args.uiLocale,
      extras,
      args.chipIntents?.[chipId],
    );
    chipIntents[chipId] = [...planned.intentIds];
    addOrMerge(planned);
  }

  // The user's answer to "where should we look", and the ceiling for everything
  // below. Empty on a free-text-only run, where there is no such answer and the
  // model's reading of the request is the only signal there is.
  const allowedIntentIds = dedupe(
    [...byId.values()].flatMap((req) => req.intentIds),
  );

  // 2. LLM only when there is free text to interpret.
  const requestText = args.requestText.trim();
  if (requestText !== "") {
    const raw = await runPlannerLlm(args, requestText, allowedIntentIds, warnings);
    if (raw) {
      for (const llmReq of raw.requirements) {
        mergeLlmRequirement(llmReq, {
          addOrMerge,
          extras,
          uiLocale: args.uiLocale,
          allowedIntentIds,
          chipIntents,
          warnings,
        });
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
  allowedIntentIds: readonly string[],
  warnings: string[],
): Promise<PlannerLlmOutput | undefined> {
  const { system, user } = buildPlannerPrompt({
    requestText,
    chipIds: args.chipIds,
    allowedIntentIds,
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
  /** The user's chosen intents. Empty = free-text-only run, model unbounded. */
  allowedIntentIds: readonly string[];
  /** Per TICKED chip, the intents the user chose. Authoritative for that chip. */
  chipIntents: Readonly<Record<string, readonly string[]>>;
  warnings: string[];
};

function mergeLlmRequirement(llmReq: PlannerLlmRequirement, ctx: MergeCtx): void {
  const intentCheck = validateIntentIds(llmReq.intentIds);
  for (const unknown of intentCheck.unknown) {
    ctx.warnings.push(`dropped_unknown_intent:${unknown}`);
  }

  // The model may pick among the intents the user chose; it may not add one.
  // Without this a single free-text requirement the model tagged `grocery`
  // pulls a whole grocery search back into a dining-only run through the
  // `orderedIntentIds` union below — the same leak from the other direction.
  if (ctx.allowedIntentIds.length > 0) {
    const allowed = new Set(ctx.allowedIntentIds);
    const kept = intentCheck.valid.filter((id) => allowed.has(id));
    for (const rejected of intentCheck.valid.filter((id) => !allowed.has(id))) {
      ctx.warnings.push(`dropped_unrequested_intent:${rejected}`);
    }
    // Every intent the model named was outside the run. It still read the
    // request correctly about WHAT to look for, so keep the requirement and
    // apply it where the user is actually looking.
    intentCheck.valid = kept.length > 0 ? kept : [...ctx.allowedIntentIds];
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
    // Where this requirement gets searched, in strict precedence:
    //
    //   1. the user ticked this chip -> their own sub-control choice, full
    //      stop. It is the only reading that came from a person who knows what
    //      they want, and the model re-reading the free text is not grounds to
    //      widen OR narrow it;
    //   2. otherwise the model named intents (already clamped above to what the
    //      user is searching) -> use those;
    //   3. otherwise `toPlannedRequirement`'s default — the requirement's FIRST
    //      catalog intent, not every intent it declares.
    //
    // (3) is the one that bit. It used to seed every intent the catalog allows,
    // and the only path that could narrow it was this one — which needs the
    // model to re-list a chip, which the planner prompt forbids in as many
    // words. So "celiac" always meant dining AND grocery, and a search for a
    // Mexican restaurant spent half its budget on "gluten free grocery store".
    const userChoice = ctx.chipIntents[catalogId];
    const base = toPlannedRequirement(
      catalogId,
      ctx.uiLocale,
      ctx.extras,
      userChoice ?? intentCheck.valid,
    );
    base.must = capHints([], base.must, must);
    base.nice = capHints([], base.nice, nice);
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
    // Replace rather than union: `base.intentIds` above is already the complete
    // answer, and unioning it with what is on the existing entry is exactly how
    // the catalog's full intent list kept creeping back in.
    ctx.addOrMerge(base, { replaceIntents: true });
    return;
  }

  // Custom free-text requirement. A requirement with zero valid intents is
  // useless (nowhere to look) — drop it with a warning rather than keep it.
  if (intentCheck.valid.length === 0) {
    ctx.warnings.push(`dropped_requirement_no_intents:${slugLabel(llmReq.label)}`);
    return;
  }
  const custom = makeCustomRequirement(
    llmReq.label,
    intentCheck.valid,
    must,
    llmReq.kind === "subject" ? "subject" : "preference",
  );
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
