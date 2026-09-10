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
  `label`, `intents`, optional `extraFields`, `mustHints`, `niceHints`, `negativeHints`.
  Today: `celiac`, `allergy`, `mold`, `diet`, `access`.
- `extraFields: ["allergens"]` points at `allergenOptions`; `["diet"]` at `dietOptions`.
  The UI and the planner must use those lists, never their own.

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
