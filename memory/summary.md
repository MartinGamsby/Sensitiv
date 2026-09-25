# Summary

Local, single-user research agent: location + requirements in, ranked dossier with quoted
evidence out. Runs fully on an empty `.env` (`FakeLlmProvider` + `FixtureBrowserSession`).

## Packages

- **`packages/shared`** (source-only): `catalog/`, Zod schemas (`src/schema/`), `env.ts`
  (`loadEnv`, `redactEnv`, `loadDotEnvFile`), `llm/` (Anthropic, OpenAI stub, Fake, factory),
  `prompts/` (incl. untrusted-content fencing), `planner/`, `safe-url.ts`, and **`score.ts` —
  the one scoring implementation** (worker ranks in flight; `packages/db` re-derives on read).
  `ai`@7 / `@ai-sdk/anthropic`@4: `claude-sonnet-5` rejects `temperature`, so
  `AnthropicProvider` never sends it.
- **`packages/db`**: only SQLite importer. Tables: `users`, `user_secrets` (must stay empty),
  `jobs`, `job_events`, `places`, `place_sources`, `evidence`, `replays`, `extraction_cache`.
  Migrations `0000`–`0012`. Every added column is nullable; `NULL` reads as "not recorded",
  never as live/0.
- **`apps/worker`**: loopback HTTP (`POST /jobs`, `GET /healthz`), poll loop, `runner.ts`,
  registry, browser sessions, merge/dossier, extraction cache, replay store. Two adapters:
  `google_maps` (browser + LLM) and `openstreetmap` (Overpass, no browser, no LLM — the only
  source with real results on an empty `.env`). `http.ts` = injected outbound fetch.
- **`apps/web`**: Next 15 + Tailwind + next-intl. Routes: `/api/jobs` (POST/GET),
  `/api/jobs/:id` (GET/DELETE), `/events` (SSE), `/replays/:replayId`,
  `/places/:key/photo`, `/api/geocode`, `/api/settings`, `/api/health`. Owned UI
  primitives in `src/components/ui/` (shadcn pattern, no Radix).

## Behaviour worth knowing

- **Scores are derived, never trusted from storage.** `getDossier` /
  `listJobSummariesForUser` re-run `scorePlace` over stored evidence; changing a weight
  re-ranks every past dossier. `places.score` exists only for SQL ordering;
  `score_breakdown_json` is used only by `effectiveRequirements` to rebuild legacy runs.
- Planned requirements are stored in `jobs.planned_requirements_json` (distinct from
  `requirements_json` = what the user ticked).
- Which intents a chip searches is the user's choice (`chipIntents`), not inferred.
- Dossier capped at 15 (`MAX_DOSSIER_PLACES`) after scoring, before persisting.
- `quick_search` (default ON) skips Maps feed scrolling (~8 vs ~22 places); the dossier
  states the caveat. `NULL` = old deep run.
- `record_session` (default OFF) — see `security-invariants.md`.
- Deleting a run keeps the extraction cache; queued/running jobs can't be deleted (409).

## Web UI gotchas

- `src/lib/theme.ts` must NOT be `"use client"` — importing a value from a client module
  into a server component yields a reference, and the pre-paint theme script broke.
- Theme: `data-theme` attr > `prefers-color-scheme` > light; stored in `localStorage`.
  Tailwind `darkMode` must resolve the same selectors as the CSS tokens.
- Place detail is `?place=<canonicalKey>`, not a child route: intercepting routes under
  `[locale]` crash Next 15.1.3 (`initialTree is not iterable`). `?view=map` for map view.
- `Disclosure` hides with `hidden`, not unmount. Disclaimer sits outside every collapsible.
- Rank medal is outside the card link; card must not be `overflow-hidden`.
- `MatchPill` hue is an inline CSS var (not a Badge tone) — Tailwind can't scan per-value
  classes. Re-check contrast at the worst hue if colours change.
- `LocationSchema` `max(500)` radius stays wide because it is on the read path; the UI
  bounds (0.5–100 km, default 3) live beside it.
- Pin and postal code are mutually exclusive; a pin (`Location.pinned`) outranks postal.

## Known gaps

- Enrichment, thumbnails, rank-before-cap, progress model: tested, not yet re-run live.
- Cross-source merge (`canonicalKey`) untuned against real OSM vs Google addresses.
- Feed depth is rate-sensitive; `proxy.sessionDuration: 15` pins one IP per job.
- Roadmap: `next-steps.md`.
