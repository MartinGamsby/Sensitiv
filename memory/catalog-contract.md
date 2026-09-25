# Catalog contract

`packages/shared/catalog/` is the source of truth. Pure data + functions.

## Rules

- Never hardcode intent/requirement unions; look up via `catalog/index.ts`. Signatures take
  `string`. Guarded by `catalog/index.test.ts`.
- A requirement's `intents` is what it CAN apply to. Default is the first; the user ticks
  others (`chipIntents`). The planner may choose among them, never add one.
- `weight` is a number, multiplied, never switched on. Safety chips (`celiac`, `allergy`,
  `mold`, `access`) 6, `diet` 4, custom preference 1, custom subject 3. **A chip is worth
  twice a subject by design** — a confirmed cuisine must not beat an unanswered safety
  question.
- `satisfiedByHints` state when `mustHints` are already met (a fully GF venue).
- UI and planner use `allergenOptions` / `dietOptions`, never their own lists.

## Claim → score

- Support: `MAX_SUPPORT_BASE (2) × confidence × source reliability × weight`. Proportional,
  no floor.
- Contradiction: `-(1 + confidence) × weight`. Keeps its floor and is **never** discounted by
  source — a hedged "I got glutened here" still counts.
- `unverified`: 0 for a preference, `-0.5 × weight` for a subject; only fires when no other
  rule did.
- `SOURCE_RELIABILITY`: `google_maps` 1, `openstreetmap` 0.7, unlisted 0.7. So an OSM tag
  can never reach `EXPLICIT_MARK_CONFIDENCE` (0.8).
- Corroboration: `MAX_CORROBORATION_BASE (0.5) × clamp(Σ reliability of distinct supporting
  sources − 1, 0, 1)`. 100% needs two fully trusted sources.
- A discounted line carries `ScoreLine.discounted` and the dossier says so.

## Adapter ids

Every id an intent declares must be in `KNOWN_ADAPTER_IDS` (`google_maps`,
`openstreetmap`) or `PLANNED_ADAPTER_IDS` (`store_locator`, `kijiji`, `craigslist` —
skipped with a warning). `REFUSED_ADAPTER_IDS` (`yelp`, `find_me_gluten_free`) must appear in
no intent; the integrity test enforces it.

## Fail closed

`getIntent`/`getRequirement` → `undefined`; `validate*Ids` → `{valid, unknown}`;
derivations return catalog declaration order; `toPlannedRequirement` throws on unknown id;
`makeCustomRequirement` never throws. `catalogPromptSummary` keeps the prompt in sync.
