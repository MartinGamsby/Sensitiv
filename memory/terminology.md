# Terminology

Domain vocabulary for Sensitiv. These are the words the spec uses; use them exactly.

- **intent** — where to look and which adapters to run. One of: `dining`, `grocery`,
  `housing`, `services`. Defined in `packages/shared/catalog/intents.ts`.
- **requirement** — a user constraint that activates one or more intents and gives the
  planner must/nice hints. One of: `celiac`, `allergy`, `mold`, `diet`, `access`. Defined
  in `packages/shared/catalog/requirements.ts`. The planner may also mint ad-hoc
  `custom_<slug>` requirements from free text.
- **adapter** — a per-source scraper registered by id (e.g. `google_maps`). The worker
  keeps a registry; an unknown id is logged and skipped, never fatal.
- **planner** — the LLM step that turns free-text request + selected chips into
  `PlannedRequirement[]` plus a deduped list of intent ids, with search queries in the
  search language.
- **dossier** — the job output: ranked places + quoted evidence + replay links. Always
  rendered with the disclaimer.
- **evidence polarity** — how a piece of evidence bears on a requirement:
  `supports` | `contradicts` | `unclear`.
- **replay** — a Solari session recording URL. Requires the `recording` option; absent on
  plans/runs without it.
- **BYOK** — "bring your own key": a session-only Solari key entered in the UI, kept in
  sessionStorage, passed in the POST body to the worker's memory only. Never persisted.
  Localhost development only.
- **partial** — a job that hit its `timeout_sec` and stopped with the results gathered so
  far. `status = "partial"`, not an error.
- **search language** — BCP 47 language tag the agent searches and quotes in. Auto-derived
  from the job location (Quebec → fr, country majority → that, else en), user-overridable.
- **UI locale** — the interface language, `en` or `fr` only. Distinct from search language.
