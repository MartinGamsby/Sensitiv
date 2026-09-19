# Catalog contract

`packages/shared/catalog/` is the **source of truth** for what Sensitiv looks for and
where. Pure data + pure functions: no I/O, no LLM, no DB.

## The hard rule

Never hardcode an intent or requirement union in business logic. Look ids up through
`catalog/index.ts`. Public signatures take `string`, not a union, so LLM-invented and
ad-hoc ids still flow through the same validation path. `catalog/index.test.ts` guards this.

## Shape

- **Intent** = where to look. `id`, per-locale `label`, ordered `adapters`, `defaultLimit`.
  Today: `dining`, `grocery`, `housing`, `services`.
- **Requirement** = a constraint that activates intents and supplies planner hints. `id`,
  `label`, `intents`, optional `extraFields`, `mustHints`, `niceHints`, `negativeHints`,
  `weight`, `satisfiedByHints`. Today: `celiac`, `allergy`, `mold`, `diet`, `access`.
- A requirement's `intents` is what it CAN apply to, never a list to search wholesale.
  `toPlannedRequirement` defaults to `defaultIntentsFor` — the FIRST intent only — and the
  rest are ticked by the user in the chip's own sub-control, sent as `chipIntents` on the
  job and stored as each `PlannedRequirement.intentIds`. The planner may choose among
  those intents; it may never add one (`dropped_unrequested_intent:<id>`). Reading
  `intents` as "search all of these" is what made a celiac + "Mexican restaurant" run also
  search `gluten free grocery store`.
- `weight` is the scoring multiplier, carried onto `PlannedRequirement` and read by
  `scorePlace`. A NUMBER, never a `"critical" | "soft"` union, so the hard rule above still
  holds: score logic multiplies by it and never switches on it. Safety-critical chips
  (`celiac`, `allergy`, `mold`, `access`) are 6, `diet` is 4, and an ad-hoc `custom_<slug>`
  requirement the planner derives from free text gets `DEFAULT_REQUIREMENT_WEIGHT` (1) —
  unless the planner marked it `kind: "subject"`, in which case it gets
  `SUBJECT_REQUIREMENT_WEIGHT` (3). This is what stops "is not Italian" outranking "is a
  dedicated gluten-free kitchen", while still letting "is a Mexican restaurant" outrank a
  gluten-free pastry shop on a search for a Mexican restaurant.
- A chip is worth exactly TWICE the subject, and that ratio is the product rather than a
  tuning knob. When they were equal at 3, `Escondite` — explicitly Mexican (+5.7), nothing
  said about gluten (0) — outranked `Arepera`, which a source called celiac-safe (+4.8). A
  confirmed cuisine must never beat an unanswered safety question in an app called
  Sensitiv: the requirement is the question, the cuisine is a filter on the answer.
- `PlannedRequirement.kind` separates the SUBJECT of a search (the kind of place: "Mexican
  restaurant", "bakery") from a PREFERENCE (a property it should have: "open late"). Only
  `scorePlace` reads it, and only for the `unverified` rule: an unsettled preference is 0,
  an unsettled subject is `-0.5 x weight`. Absent reads as `"preference"`, so a job row
  written before the field existed re-scores unchanged.
- `satisfiedByHints` state when the `mustHints` are ALREADY met, and are rendered into the
  extraction prompt. `mustHints` are written as the strict reading ("dedicated gluten-free
  kitchen or documented GF protocol"), which describes how a MIXED kitchen proves itself; a
  wholly gluten-free venue satisfies it by construction and was being marked `unclear` for
  not phrasing it that way.
- `extraFields: ["allergens"]` points at `allergenOptions`; `["diet"]` at `dietOptions`.
  The UI and the planner must use those lists, never their own.

## Source reliability

`SOURCE_RELIABILITY` in `catalog/intents.ts` multiplies a SUPPORTING claim's confidence
by how much its source is worth: `google_maps` 1, `openstreetmap` 0.7, and
`DEFAULT_SOURCE_RELIABILITY` (0.7) for anything unlisted, so an unassessed source cannot
claim full confidence just by existing. Consequences worth knowing:

- a community tag can never be reported as an `explicit` mark — `diet:gluten_free=only`
  at 0.95 lands at 0.665, below `EXPLICIT_MARK_CONFIDENCE`. No tag a volunteer typed,
  unreviewed and undated, stands as an explicit mark that a kitchen is celiac-safe;
- CONTRADICTIONS are deliberately NOT discounted. "A reviewer says they got glutened
  here" is not a claim to quietly turn down because of where it was found — the cost of
  under-weighting it is not the cost of over-weighting a volunteer's "yes";
- corroboration scales with summed reliability, not row count:
  `MAX_CORROBORATION_BASE * clamp(sum(reliability of distinct supporting sources) - 1, 0, 1)`.
  One source repeating itself pays nothing; a listing plus a community map pays 0.7 of the
  bonus. 100% therefore needs two fully-trusted sources, which Sensitiv does not yet have —
  the honest reading of a run that could not fully corroborate anything;
- any line built on a discounted claim carries `ScoreLine.discounted`, and the dossier
  says so in words. A discount that reorders a ranking is never silent.

## Adapter ids

An intent may name an adapter that has no implementation yet. `KNOWN_ADAPTER_IDS` lists the
implemented ones and `PLACEHOLDER_ADAPTER_IDS` the deliberate gaps; the integrity test
requires every declared adapter id to appear in one of them. The worker registry logs and
**skips** an unregistered id — a housing job that unions `kijiji`/`craigslist` still
completes with a warning.

## Fail closed

- `getIntent` / `getRequirement` return `undefined` for an unknown id; the `isValid*`
  predicates return `false`.
- `validateIntentIds` / `validateRequirementIds` partition into `{ valid, unknown }` so the
  caller can log what was dropped. This is the "second channel" — derivations themselves
  drop silently.
- `intentsForRequirements` and `adapterIdsFor` always return **catalog declaration order**,
  never Set-iteration or caller order, so tests are reproducible.
- `toPlannedRequirement` throws on an unknown id — its input is our own UI chip, so a miss
  is a bug. `makeCustomRequirement` never throws: it slugifies free text to
  `custom_<slug>` and drops unknown intent ids.
- `catalogPromptSummary(locale)` renders every intent and requirement id into the planner
  prompt, so the prompt cannot drift from the catalog (also guarded by a test).
