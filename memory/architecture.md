# Architecture

## Package boundaries

```
apps/web      Next 15 App Router. Validates input, owns the user boundary, enqueues.
              NEVER runs a job in a route handler.
apps/worker   Long-running Node 22 process. Owns the agent loop and all browser work.
packages/db   The ONLY module allowed to import drizzle-orm / @libsql/client.
packages/shared  Source-only (no build): catalog, Zod schemas, env, llm, prompts, planner.
```

Dependency direction is one-way: `web` and `worker` both depend on `db` and `shared`;
`db` depends on `shared`; `shared` depends on nothing in the repo. `web` and `worker`
never import each other — they meet at the SQLite file and at one loopback HTTP POST.

## The flow

1. `POST /api/jobs` — Zod-validates the body, resolves the local user, maps chip ids to
   `PlannedRequirement[]` through the catalog, inserts a `queued` job, then fires
   `POST {WORKER_URL}/jobs { jobId, solariKey? }`. A failed enqueue is not an error: the
   row stays `queued` and the worker's poll loop picks it up.
2. The worker runs `runJob(db, jobId, deps)`.
3. Every step of the run appends a `job_events` row. `GET /api/jobs/:id/events` tails that
   table with a `Last-Event-ID` cursor on a 500 ms poll and emits SSE to the browser. The
   browser never talks to the worker — no CORS, no exposed worker, events survive a reload.
   The route sends an immediate `job-status` frame on connect ONLY when the job is still
   `queued`/`running` — never when it is already terminal. `use-job-events.ts` closes the
   `EventSource` on the FIRST terminal status frame it sees, and a fixture-backed job
   routinely finishes before the client even connects; sending that frame unconditionally
   closed the stream before a single `job_event` (including the `degraded-*` notices) had
   been flushed. The terminal path is `tick()`'s job: flush everything, drain stragglers,
   THEN send the one terminal frame.
3b. A handful of those rows also carry a `progress` payload (`job_events.progress_json`,
   migration `0004`) — `{phase, done?, total?}` over the five phases in
   `packages/shared/src/schema/progress.ts`. It is the ONLY thing the run page's progress
   bar reads: the bar never parses a message, so rewording a log line cannot move it. The
   `sources` phase counts adapters, so the bar has sub-step granularity inside the phase
   that dominates a run. Between markers `RunProgress` creeps asymptotically toward the
   next milestone and never overtakes it, and a monotonic high-water mark means the bar
   cannot go backwards. The ETA blends a median of the user's recent finished runs
   (`recentRunDurationsForUser`, read in the run page's server pass) with this run's own
   pace, clamped to the job's timeout — a heuristic, and labelled as one in the UI.
4. `GET /api/jobs/:id` returns the assembled `Dossier`.
5. `GET /api/jobs` (History) returns each job plus a `placeCount` and best-scoring
   `topPlace`, from one grouped repository call (`listJobSummariesForUser` in
   `packages/db/src/results.ts`) — `listJobsForUser` plus a single query over `places`
   restricted to those job ids, never an N+1 loop, and never derived from request input.

## The agent loop (`apps/worker/src/runner.ts`)

`markJobRunning` -> user defaults -> location -> resolve search language -> `plan()` ->
union adapters from the planned intents (`adapterIdsFor`) -> run adapters, at most
`MAX_CONCURRENT_BROWSERS` (3) at a time, each with its own `BrowserSession` -> extract ->
Zod -> evidence -> `mergeFindings` on the canonical key -> `scorePlace` -> rank -> cut to
`MAX_DOSSIER_PLACES` -> `writeDossier` -> attach replay metadata -> `finishJob`.

- **When a browser is launched at all** (Section 1): two gates sit in front of
  `launchBrowser`, because a live session is paid, recorded and rate-limited.
  (1) `Adapter.needsBrowser` (default true) — the three v1.1 stubs set it `false`, and the
  runner hands them a plain `FixtureBrowserSession` without calling `launchBrowser`, so they
  cost nothing and produce no replay row. (2) `allowLive`, computed once per run in `runJob`
  as `!llmUnusable` (`llm.name === "fake"`, or the planner failed with
  `planner_llm_failed:auth`; `:network`/`:schema` are transient and do NOT downgrade a
  correctly-keyed run) and passed into `LaunchOptions` — `launchBrowser` short-circuits to
  fixtures before it reads the key or loads the SDK. A run that trips gate 2 with a Solari
  key present emits `solari-skipped-no-llm`, and the `degraded-solari` notice is suppressed
  (it would claim the browser "could not start" when the run never tried). Both gates feed
  the two bullets below: gate 2 is why `sourceModes` can read `fixture` on a keyed run, and
  gate 1 is why a stub adapter has no replay row rather than an empty one.

- **Replay capture** (Section 2): the presigned Solari replay link expires in ~900s, so
  persisting it and rendering it later produces a dead link. Instead, each adapter's
  `finally` block (`captureReplay()` in `runner.ts`) calls `getReplayUrl()` (releases the
  session), then `downloadReplay()`, then `storeReplay()` (`apps/worker/src/replay-store.ts`)
  — each in its own try/catch, best-effort, never failing the job. Bytes land under
  `data/replays/<jobId>/<sessionId>.ndjson[.gz]` (gitignored), resolved through the same
  `findRepoRoot()` both the worker and the Next server already use for the SQLite file. A
  `replays` row records `status` (`stored` / `link_only` / `empty` / `unavailable` /
  `too_large`), `adapterId`, `findingCount`, and — for `stored` — the size, content type, and
  repo-relative path. `GET /api/jobs/:id/replays/:replayId` is the only reader, scoped by
  `user_id` through `getReplayForJob`. No retention policy yet — 25 MB cap per replay, at
  most a few per job, on a local single-user app; acceptable for now.

- **Source-mode provenance** (Section 3): `jobs.source_modes_json` (nullable text,
  serialized `Record<string, "fixture" | "live" | "stub">`) records the ACTUAL mode
  each part of the run used, not an env lookup — keyed by adapter id plus the reserved
  `"llm"` key. `runJob` seeds `sourceModes.llm` right after the planner block (`"fixture"`
  when the LLM is the fake fallback, or when the planner failed with
  `planner_llm_failed:auth` — the key was there but nothing real happened); `runAdapters`
  sets `sourceModes[adapter.id] = browser.mode` synchronously right after each
  `launchBrowser` resolves (safe under up to 3 concurrent adapters: distinct keys, no
  `await` between the assignment and the read), and `"stub"` for a `needsBrowser: false`
  adapter that never launches one. `"stub"` is deliberately NOT `"fixture"`: only
  `"fixture"` drives the dossier's sample-data strip (`dossier.tsx`) and the History badge
  (`job-history.tsx`), both of which filter on `mode === "fixture"` exactly; since every
  job resolves some v1.1 no-op adapters, folding them into `"fixture"` would pin that
  warning open on 100% of runs, live ones included. Stub sources get a muted
  `dossier.notSearched` line at the bottom of the dossier instead.
  `setJobSourceModes` (`packages/db/src/jobs.ts`) persists it
  next to `writeDossier`, best-effort, on every terminal path (done, partial, and both the
  timeout and hard-failure branches of `runJob`'s `catch`). `getDossier` maps a `NULL`
  column to `{}` (`Dossier.sourceModes` defaults to `{}` too) — every pre-existing job
  renders as "not recorded" everywhere (the History badge, the dossier's "sample data"
  strip), never as "live". This is what makes a reopened run's provenance mark survive
  regardless of the CURRENT `.env` — the run page's `degraded-*` banners
  (`deriveNotices` in `run-view.tsx`) are a separate, event-log-derived mechanism that
  already worked this way; they are not env-derived either, and this section did not touch
  them.
- **Location resolution** (the fix for job 8150b7c4, which searched Quebec City for a
  Montreal postal code): a Maps search URL with no `/@lat,lng,<z>z` segment lets GOOGLE
  pick the viewport from the query text, and it picks badly. There are now two tiers.
  (1) `apps/web` forward-geocodes the typed text at submit through `GET /api/geocode?q=`
  (Nominatim `/search`, same hardcoded-origin SSRF hardening as the reverse branch) and
  stores `lat`/`lng` on the `Location`. (2) `google_maps` resolves a viewport itself before
  searching: `locationProbe()` builds a probe string with the POSTAL CODE FIRST, loads it
  on Maps, and reads the `@lat,lng,<z>z` Maps writes back. Tier 2 owns postal codes
  because OpenStreetMap has NO Canadian postal data at all (Canada Post licenses it) — the
  web geocode returns nothing for "H1S" in every phrasing, while Google resolves
  "H1S, Canada" to Saint-Léonard unaided. Zoom always comes from `zoomForRadiusKm(radiusKm)`,
  never from Google's own (which describes the feature it matched, not the search radius).
  Anchored searches send `SearchQuery.subject` (no location phrase); unanchored ones fall
  back to `.query`. A viewport overrides conflicting text, so this is belt AND braces.
- **Result depth**: Maps lazy-loads its feed. One `evaluate` after load sees ~6 places;
  scrolling to exhaustion saw ~22, with the expected top result at index 15. `scrollFeed()`
  scrolls until the count stops growing, and logs how far it got — a run throttled to a
  shallow feed says so rather than looking like "only 6 places exist". Cards must carry a
  `/maps/place/` link to count, which both drops the filter-chip row (it was reaching the
  LLM as a place named "Filters available for this search") and yields the handle the
  enrichment pass reopens the place with.
- **Every planned query runs, and results are ranked before the cap.** The adapter used
  to `break` on `findings.length >= ctx.limit` and then `slice(0, ctx.limit)`. Both were
  sized for ~6 results per query; at ~30 the break trips on the FIRST query, so a celiac +
  "Italian" run searched only "sans gluten restaurant" and never issued the user's actual
  subject, then kept a blind prefix of whatever order Google rendered. Now: all queries run,
  `dedupeByPlace()` collapses a place that matched more than one of them (otherwise it
  arrives twice with half its evidence each and competes with itself for a slot), enrichment
  runs, and only then does `scorePlace` rank and `ctx.limit` cut. Ties break on review count.
- **Thumbnails**: scraped from the result cards the search stage already reads, so every
  place gets one and no extra page load is spent; the detail page's largest photo is the
  fallback during enrichment. Deliberately NOT routed through the LLM — a URL is what a
  model will invent, and an invented one would be persisted and rendered — so it is matched
  back by name after extraction. Gated by `safeThumbnailUrl` on write and
  `safeThumbnailSrc` on render (two different boundaries; the second also covers rows
  written before the first existed). Both are stricter than `safeExternalHref`: that guards
  a link a user clicks, this becomes an `<img src>` the browser fetches unprompted.
- **Enrichment**: a result card is ~600 chars and cannot settle "dedicated gluten-free
  kitchen", so nearly everything came back `unclear` on the requirement the user cared
  about. For up to `MAX_ENRICH_PLACES` places that `unverifiedRequirements()` flags on a
  heavy requirement, the adapter opens the Maps detail page (full address, website, and the
  review-topic chips whose aria-labels read "gluten free, mentioned in 89 reviews" —
  quantified evidence invisible to `innerText`), and falls through to the official website
  when that still leaves it open. It researches ONLY requirements with a `catalogId` — the
  chips the user picked. The free-text subject is what Google already matched on, so a place
  in the results satisfies it by construction; re-litigating it burned five of one run's six
  page loads looking for "Cuisine italienne" on the websites of gluten-free bakeries.
  Evidence is folded into the EXISTING finding, never
  emitted as a new one: a detail page reports a fuller address, and letting that through
  `canonicalKey` would split one place in two. The website is the only URL in the adapter
  not built from our own constants, so it goes through `isSafeSiteUrl()` first.
- **Browser context**: `launchBrowser` takes `context: SessionContextOptions` and the live
  session lazily opens ONE `newContext({ locale, timezoneId, geolocation, permissions })`
  that every page is opened in. Solari's own geo controls cannot do this — `ProxyRequest`
  `.state`/`.city` are documented US-only, so outside the US the proxy can only pin a
  COUNTRY. `timezoneId` defaults to the one the gateway reports for the egress, because a
  browser whose clock disagrees with its IP is both a fingerprint and a source of wrong
  opening hours. A context option the plan rejects degrades to the plain session.
- **Scoring** (`src/score.ts`): per requirement, a base delta times the requirement's
  `weight` — `explicit` +2, `supported` +1, `corroborated` +1, `contradicted` -2,
  `unverified` 0. Two old rules are deliberately gone. The flat `-1 "only a single source"`
  penalty fired on essentially everything, because Sensitiv HAS exactly one working source,
  while its `+1` mirror could never fire; corroboration is now a bonus only. And `unclear`
  used to trip that same `-1`, making "the page does not say" score worse than no evidence
  at all — it is now 0. `writeDossier` takes the planned requirements so a requirement no
  source mentioned still gets an honest `unverified` line.
- **The score's VOCABULARY lives in `@sensitiv/shared`** (`src/schema/score.ts`):
  `ScoreLine`/`ScoreRule`, `MAX_REQUIREMENT_BASE` (2.5 — `explicit` at full confidence
  plus `corroborated`), `PROXIMITY_MAX` (2), `maxAchievableScore()` and `scorePercent()`.
  The rubric itself stays in the worker; what is shared is what the DOSSIER needs to state
  a score as a percentage of the best this run could have scored. Same reason
  `requirementStanding` sits beside `Evidence`. `score.test.ts` asserts no combination of
  evidence scores above that ceiling — without it a new rule would silently push perfect
  places past 100%, clamp, and flatten the top of every ranking.
- **The breakdown is PERSISTED**, not recomputed: `places.score_breakdown_json`
  (migration `0009`), written by `setPlaceScore` and read onto `DossierPlace.breakdown`.
  The explanation a reader expands is the one that actually produced the ranking, even
  after the rubric moves on. NULL on every pre-existing row -> `[]` -> the card says it has
  no breakdown rather than inventing one.
- **The dossier is capped at `MAX_DOSSIER_PLACES` (15)** in `writeDossier`, AFTER scoring
  (the cut has to be the bottom of the RANKING) and BEFORE persisting (so every later
  reader sees the same bounded set). Tie-break matches `getDossier`'s own
  `(score desc, canonical_key)`. The run logs the count, the cut-off score and the names
  it left out. Nothing downstream filters, so the list stays at or below the cap under
  every ordering.
- **The extraction cache** (`apps/worker/src/extraction-cache.ts` +
  `packages/db/src/extraction-cache.ts`, table `extraction_cache`, migration `0010`) is
  the one cache in the repo. `extractFindings` splits a blob into per-place units
  (`cacheableUnits`: a search blob's `results` array, or one enrichment blob), serves the
  hits, and re-wraps ONLY the misses into the prompt — the saving is in what the model is
  asked, not just in what it answers. Attribution back to a unit is by name; a finding
  that matches no unit, or a name that appears twice in one blob, is simply not stored,
  so a failure to attribute costs a future miss and never a wrong hit. The key covers
  scraped content + requirements + locales + source, and NOT the weight (applied later by
  `scorePlace`, so re-tuning it must not discard a good extraction). Injected as
  `AdapterContext.extractionCache`, absent when the TTL is `0` — the same seam style as
  `AdapterContext.fetch`. See `security-invariants.md` for why it is the one table with
  no `user_id` and why every row expires.
- **Nothing ELSE is cached.** No job-level reuse of an identical (location +
  requirements) search, no browser profile reuse between sessions, and no Anthropic
  prompt caching in `AnthropicProvider` — the extraction system prompt measures 923
  tokens against `claude-sonnet-5`'s 1024-token minimum cacheable prefix, so a
  `cache_control` breakpoint there would silently never engage. Baseline, job
  `906508d9` (3:01 total): OSM 8.8s, Maps 175.5s = resolve 0.0s + searches 110.1s (of
  which LLM extraction 92.9s) + enrich 65.4s. See `next-steps.md`.
- A single `JobBudget` (`src/timeout.ts`) owns one `AbortSignal` threaded into the planner
  and every adapter. On expiry the loop stops scheduling, drains briefly, writes what it
  has and finishes `partial` — never `error`.
- One adapter throwing does not fail the job: the error is logged as a `job_events` error
  row naming the adapter, and the run continues.
- `try/finally` around each session guarantees `captureReplay()` (skipped for fixture
  sessions) then `close()` even on timeout, so no browser session is orphaned. That call
  order is not an accident: the live Solari session releases the browser (and its
  Solari-side session) internally the first time either `getReplayUrl()` or
  `downloadReplay()` is called — both run inside `captureReplay()` — so they always read a
  completed session per the SDK's documented example, and the trailing `close()` only tears
  down the SDK client itself.
- A claimed job always reaches a terminal status. `runJob` writes its own, but anything it
  throws *before* `markJobRunning` (bad env, a deleted row) is caught in `server.ts` and
  finished as `error` with a secret-scrubbed `error_text`; the poll loop also keeps an
  in-memory set of attempted ids so a still-`queued` row can never be re-claimed forever.

## Run progress

The bar on the run page reads `job_events.progress`, and `JobProgress` splits two things
that must not share a number:

- `within` (0..1) drives the BAR.
- `done` / `total` / `unit` only LABEL it.

They cannot be one value because the honest label changes units partway through a phase
("search 2 of 2", then "place 7 of 22"), and a bar following the label would run backwards
at the handover. `sources` is also weighted by real work rather than adapter count —
`runAdapters` scores a stub at 1 and a browser adapter at 20 — because three of a dining
job's four adapters are v1.1 stubs that finish in under a millisecond, which put the bar at
71% of the whole run one second in and then froze it for five minutes.
`AdapterContext.reportProgress` is how an adapter contributes its own sub-steps;
`google_maps` splits its share across resolve / queries / enrich / finish and revises the
place total upward once the searches reveal how many places there are to check. Progress
writes are fire-and-forget: awaiting a DB write in an adapter's hot loop would make the bar
the thing the run waits on.

## Testability seams

- `RunJobDeps`: `registry`, `llm`, `solariKey`, `browserFactory`, `logger`, `logSink`,
  `timeoutSec`, `drainMs`.
- `launchBrowser({ factory })` short-circuits all Solari plumbing.
- `__setSolariModuleLoader()` (`apps/worker/src/browser/solari.ts`) swaps the dynamic
  `import("@solarisdk/browser")` for a stub loader, so tests can drive the live-client path
  — happy path, replay-URL unwrapping, downgrade retry, teardown — with zero network calls.
- `startServer({ port: 0, db, env, poll, pollIntervalMs, runJob })` for the worker HTTP
  surface; `runJob` is injectable so the crash/terminal-state path is testable.
- `__setWebDeps({ db, env, fetch })` for web route handlers; `__resetGeocodeRateLimit()`
  for the geocode limiter.
- `createDb(":memory:")` + `runMigrations` (see `apps/worker/test/helpers.ts` and
  `packages/db/test/helpers.ts`) gives every test an isolated, migrated database.
