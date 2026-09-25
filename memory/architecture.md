# Architecture

## Boundaries

`web` and `worker` depend on `db` + `shared`; `db` on `shared`; `shared` on nothing.
`web` and `worker` never import each other — they meet at the SQLite file and one loopback
POST. The browser never talks to the worker.

## Flow

1. `POST /api/jobs`: validate, resolve local user, map chips via catalog, insert `queued`,
   POST `{jobId, solariKey?}` to worker. Failed enqueue is fine — poll loop picks it up.
2. Worker `runJob`: stores planned requirements (`setJobPlan`), appends `job_events` rows.
3. `GET /api/jobs/:id/events`: tails `job_events` (500 ms poll, `Last-Event-ID`) as SSE.
   Sends an initial status frame only for queued/running jobs — the client closes on the
   first terminal frame, so a terminal one up front would drop every event.
4. Some events carry `progress_json` `{phase, done?, total?}`; the progress bar reads only
   that, never message text. `within` drives the bar, `done/total/unit` only label it.
   Browser adapters weigh 20, API adapters 1. Progress writes are fire-and-forget.
5. `GET /api/jobs/:id` → `Dossier`. `GET /api/jobs` → one grouped query
   (`listJobSummariesForUser`), no N+1.

## Agent loop (`apps/worker/src/runner.ts`)

running → defaults → location → search language → `plan()` → `adapterIdsFor` → adapters
(max 3 concurrent, own session each) → extract → Zod → merge on canonical key →
`scorePlace` → rank → cap 15 → `writeDossier` → replays → `finishJob`.

- **Browser gates** (live sessions are paid): `Adapter.needsBrowser: false` gets a fixture
  session without `launchBrowser`; `allowLive = !llmUnusable` (fake LLM or
  `planner_llm_failed:auth` — not `:network`/`:schema`) short-circuits to fixtures and emits
  `solari-skipped-no-llm` instead of `degraded-solari`.
- **Source modes**: set from what actually ran, per adapter, right after launch; browserless
  adapters report their own via `AdapterResult.mode`. A thrown adapter or failed Overpass is
  `unavailable` — never substitute sample data for an outage. Persisted on every terminal
  path by `setJobSourceModes`.
- **Replays**: each adapter's `finally` runs `captureReplay()` (getReplayUrl → download →
  store, each best-effort) then `close()`. Bytes at `data/replays/<jobId>/<sessionId>…`.
  Skipped when recording is off.
- **Failures**: one adapter throwing logs an error event; the run continues. Budget expiry
  → `partial`. Anything thrown before `markJobRunning` is finished `error` by `server.ts`.
  `reapAbandonedJobs` finishes stranded `running` jobs at startup (single worker only).

## `google_maps` adapter

- **Location**: web forward-geocodes via Nominatim; the adapter resolves a viewport itself
  (postal code first — OSM has no Canadian postal data). Zoom from `zoomForRadiusKm`. A pin
  skips the resolve hop.
- `page.evaluate` strings must be IIFEs — Playwright evaluates a string as an expression,
  so `"() => {…}"` returns undefined. Tests run the strings through real `eval()`.
- All planned queries run, up to 3 at once in separate tabs (staggered by `THROTTLE_MS`).
  Tabs come from one shared pool (`tabsFor`/`mapOnPages`: one call per tab at a time).
  Scrapes don't touch the LLM. Then `mergeCards` makes one card per place across queries
  (keyed on the Maps feature id, extra snippets in `otherSnippets`), and every card is
  extracted in one concurrent pass. After that: `dedupeByPlace`, enrich, rank, cut.
  Ties → review count.
- Deep-run scroll polls for new cards (`COUNT_FN`) instead of sleeping `SCROLL_SETTLE_MS`.
- **Enrichment** (≤10 places): detail page (review-topic chips carry counts), then the
  official site via `isSafeSiteUrl`. Only for catalog requirements. Evidence folds into the
  existing finding. A place is skipped if `ctx.limit` final scores already beat its
  `bestCaseScore` (every planned requirement confirmed at confidence 1). Final means never
  queued, already enriched, or already skipped. The same check runs again before the
  website hop. It's an exact bound, except for off-plan `custom_*` claims. A photo-only
  website hop takes `og:image` and skips the LLM call.
- **Thumbnails**: card photo → detail hero → site `og:image` → OSM `image=`. Never via LLM.
- Browser context: one `newContext({locale, timezoneId, geolocation})`; timezone matches
  egress.

## Scoring

Implementation: `packages/shared/src/score.ts`; vocabulary/constants in
`src/schema/score.ts`. Rules: `explicit`, `supported`, `corroborated`, `contradicted`,
`unverified`, `related`, `mismatched`, `proximity` (±`PROXIMITY_MAX` 2, linear to −2 at
twice the radius). A place's category is graded against a subject's `categoryHints`
(`CATEGORY_MATCH_CONFIDENCE` 0.75). Displayed as % of `maxAchievableScore` for the run;
`score.test.ts` asserts nothing exceeds it. Formula details: `catalog-contract.md`.

## Caching

Only `extraction_cache` (migration `0010`): per-place units, only misses reach the prompt,
keyed on content + requirements + locales + source (not weight). Unattributable findings
aren't cached. Nothing else is cached; Anthropic prompt caching skipped (system prompt 923
tokens < 1024 minimum).

## Test seams

`RunJobDeps` (registry, llm, solariKey, browserFactory, logger, fetchImpl, timeouts);
`launchBrowser({factory})`; `__setSolariModuleLoader()`; `startServer({port: 0, runJob,…})`;
`__setWebDeps({db, env, fetch})`, `__resetGeocodeRateLimit()`;
`createDb(":memory:")` + `runMigrations`.
