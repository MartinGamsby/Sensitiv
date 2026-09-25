# Terminology

- **intent** — where to look / which adapters run: `dining`, `grocery`, `housing`,
  `services`. User picks per chip.
- **requirement** — a constraint: `celiac`, `allergy`, `mold`, `diet`, `access`, or a
  planner-minted `custom_<slug>`.
- **subject vs preference** — `PlannedRequirement.kind`. Subject = kind of place
  ("Mexican restaurant"); preference = a property ("open late"). Absent = preference.
- **adapter** — per-source scraper registered by id. Unknown id: logged and skipped.
- **finding** — one adapter's output for one place (`PlaceDetail` + `PlaceSource` +
  `Evidence[]`).
- **canonical key** — normalized name + first street-number token; merge/upsert key.
- **evidence polarity** — `supports` | `contradicts` | `unclear`.
- **conflicted** — both supporting and contradicting evidence; kept and flagged.
- **planner** — LLM step: free text + chips → `PlannedRequirement[]` + intents + queries.
- **dossier** — ranked places + quoted evidence + replay rows + disclaimer.
- **replay / replay status** — a recorded browser session, downloaded while its ~900s
  presigned link is live. Status: `stored`, `link_only`, `empty`, `too_large`,
  `unavailable`, `expired`. No browser → no row.
- **source mode** — per adapter id + `"llm"`, what this run actually used: `live`,
  `fixture` (sample data — the only value that trips the sample-data strip/badge),
  `unavailable` (asked, couldn't answer), `stub` (legacy rows only). `{}` = not recorded.
- **BYOK** — session-only Solari key: sessionStorage → POST body → worker memory. Localhost.
- **partial** — job hit its timeout; results so far, not an error.
- **budget** — `JobBudget`: deadline + one `AbortSignal` for planner and adapters.
- **fixture session** — `FixtureBrowserSession`, serves committed payloads.
- **search language** (BCP 47, auto from location) vs **UI locale** (`en`/`fr` only).
