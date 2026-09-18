# Next steps

Priority order for the work after the v1 scaffold (PR #1). Each item is roughly one PR.
Update this file as items land or the ordering changes.

## 1. Make a real search actually work — and show fake-vs-live in the UI

The v1 scaffold plans, merges, scores, streams and persists a real dossier, but with an
empty `.env` (the default `pnpm dev`) it never opens a browser: every job returns the
identical `apps/worker/fixtures/google-maps-plateau.json` regardless of input. Closing
this gap is the whole point of v1.

- ~~`.env` at the repo root was silently never loaded.~~ **Fixed.** Neither Next's own
  `.env*` lookup (`apps/web/` only) nor the worker's plain `tsx` process read the monorepo
  root — a real `SOLARI_API_KEY` in `.env` had no effect on either process. Both now call
  `loadDotEnvFile()` (`packages/shared/src/env.ts`) as the first thing at startup. This is
  what a real Solari key needs before the SDK-shape item below even matters.
- ~~**Verify the Solari SDK.**~~ **Fixed.** `apps/worker/src/browser/solari.ts` was written
  against a *speculative* `@solarisdk/browser` shape. The real package (pinned `0.1.4`) is
  now installed and the wiring matches it: the guessed `createClient` branch is gone (the
  real client is `new Solari({ apiKey, timeoutMs, maxAttempts })`); the replay URL — the bug
  that actually broke a live run — was an object (`{ url, expiresInSeconds,
  contentEncoding }`) fed straight into a `text()` column and a `z.array(z.string())`
  schema, and is now unwrapped to `.url`; the downgrade retry no longer fires on every
  launch failure, only on `FeatureRequiresPlan`; the proxy sticky-session id was the raw
  36-char job UUID where the SDK documents "alnum + dash, ≤32 chars", and is now trimmed;
  and the Solari client is now closed alongside the browser instead of leaking — on the
  failed-launch path too, where it holds an already-started local proxy socket. The replay
  URL is polled across the SDK's documented "~1-3s after release" window instead of being
  asked for once, immediately, and the give-up warning names the actual error. Tests drive
  the live path through an injectable module loader instead of relying on the package being
  absent, so the suite stays network-free. Still unexercised against a live key.
- ~~**Stop burning paid Solari sessions on runs that cannot use them.**~~ **Fixed.** Two
  separate waste paths: (1) a job with a `SOLARI_API_KEY` but no working `ANTHROPIC_API_KEY`
  still opened live, recorded browser sessions even though planning had fallen back to
  `FakeLlmProvider` and extraction could not work either — canned queries in, nothing useful
  out, at Solari's expense. `runJob` now computes `llmUnusable` (fake LLM, or
  `planner_llm_failed:auth`; `:network`/`:schema` are transient and do NOT downgrade a
  correctly-keyed run) and passes `allowLive: !llmUnusable` into `launchBrowser`
  (`LaunchOptions.allowLive`, `apps/worker/src/browser/solari.ts`), which short-circuits to
  `FixtureBrowserSession` before ever touching a key. A new `solari-skipped-no-llm`
  `job_events` source (and `run.notice.solariSkippedNoLlm` banner) explains why when a Solari
  key was present; the existing `degraded-solari` notice is now guarded on `allowLive === true`
  so it stays accurate. (2) The three v1.1 stub adapters (`yelp`, `find_me_gluten_free`,
  `store_locator`) never touch `ctx.browser` but `runAdapters` launched one for every adapter
  regardless — 3 wasted paid sessions per run, every run. `Adapter.needsBrowser` (default
  true, `apps/worker/src/adapters/types.ts`) lets an adapter opt out; the three stubs set it
  `false`, `google_maps` sets it `true` explicitly, and the runner now only calls
  `launchBrowser` when `needsBrowser !== false`, handing the stubs a plain
  `FixtureBrowserSession` directly instead.
- ~~**Real Google Maps extraction.**~~ **Fixed — root cause was `page.evaluate(string)`
  semantics, not the selectors or the wait.** Two real live runs (both keys configured) both
  came back with 0 places on every query. The user downloaded the session replays and they
  were inspected directly (Solari's recording is rrweb-format — `type: 2` events are full DOM
  snapshots, `type: 3` mutation events show nodes as they're added). Both recordings prove the
  selector cascade was always correct — real result cards ARE `div[role="article"].Nv2PK`
  under `div[role="feed"] > div > div[jsaction]`, with a real `aria-label` name on the inner
  `a[href*="/maps/place/"]` anchor — and that the feed rendered **fast** (as little as ~500ms
  after navigation in the second recording, via a DOM mutation, not even a full page load).
  A first attempt raised `FEED_WAIT_TIMEOUT_MS` 6s → 20s on the theory that a cold session was
  outrunning the wait; the second real run still returned 0 raw cards with every query timing
  out at the full 20s, which is what proved the wait was never the problem — the probe was
  never seeing ANY DOM state, fast or slow. The actual bug: `BrowserPage.evaluate` forwards
  `FEED_PROBE_FN`/`SCRAPE_FN` as raw strings straight to the real (Playwright-based, via
  `patchright-core`) `Page.evaluate`, and Playwright's string form is `eval`-style — it
  evaluates the STRING AS AN EXPRESSION, it does not detect "this looks like a function" and
  call it (Playwright's own docs example: `page.evaluate('1 + 2')` → `3`). A bare
  `"() => {...}"` string evaluates to the function *value* itself, which can't be serialized
  back over the CDP wire, so `evaluate()` silently resolved to `undefined` on **every single
  call**, regardless of what was actually on the page — explaining both "failed" runs
  identically and independently of timing. Fixed by wrapping both strings as IIFEs
  (`"(() => {...})()"`) so evaluating the string actually invokes the function and returns a
  real, serializable value. This also exposed a real gap in the existing test suite: the
  mocked `evaluate()` in `google-maps.test.ts` pattern-matches the string's *content* and
  returns a canned value — it never actually ran these strings through anything eval-like, so
  87 "passing" tests gave false confidence while this was completely broken in production. A
  new `describe` block in that file runs `FEED_PROBE_FN`/`SCRAPE_FN` through real `eval()`
  against a stub `document`/`location` to guard against this exact bug class recurring.
  Along the way, also fixed a logging bug: the "raw card(s)" line was actually reporting the
  post-name-extraction count, not the true DOM match count — `SCRAPE_FN` now returns
  `rawCount` and per-tier `tierCounts` separately, so a future 0-result run's log can tell DOM-
  empty apart from cards-present-but-name-extraction-failed. **Still unverified end-to-end
  against a live key** (no Solari key in this environment) — the next live run is the real
  test. Still open and untouched by this pass: the "showing results in another city" redirect
  (rewrite the query with neighbourhood + region).
- ~~**Surface run provenance.**~~ **Fixed.** The worker emits `degraded-llm` /
  `degraded-solari` `job_events` (keyed by `source`) and the run page renders an amber
  banner for each (`deriveNotices` in `run-view.tsx`, `run.notice.*` messages) — that part
  reads the event log, not env state, and always did. What was actually missing is now in
  place too: a *persisted* per-source mode on the job (`jobs.source_modes_json`, keyed by
  adapter id plus the reserved `"llm"` key), populated onto the `Dossier` as `sourceModes:
  Record<string, "fixture" | "live">`. The worker records the actual provider/browser mode
  that ran (`runJob` seeds `sourceModes.llm` right after the planner block; `runAdapters`
  sets `sourceModes[adapter.id] = browser.mode` synchronously after each `launchBrowser`)
  and persists it via `setJobSourceModes` next to `writeDossier`, on every terminal path
  except a hard job failure. `NULL`/`{}` (every pre-existing run) renders as "not recorded",
  never "live" — in the History card's badge (`job-history.tsx`) and the dossier's own
  "this dossier contains sample data" strip (`dossier.tsx`), both driven by `sourceModes`
  so the mark survives reopening a run regardless of the current `.env`. The History list
  also now shows a formatted date/time per run and a top-place-or-"no places found" summary
  line, backed by one new grouped query (`listJobSummariesForUser` in
  `packages/db/src/results.ts`) instead of an N+1 loop.
- ~~**Replay links expire.**~~ **Fixed.** `sessions.getReplayUrl()` returns a presigned URL
  with an `expiresInSeconds`, and the old fix idea (mint on demand) turned out to have a
  second, sharper bug: the SDK's `fetch` auto-decompresses a gzip response, so the same
  presigned URL either downloads as empty/corrupt or as plain NDJSON with a `.gz` filename
  depending on timing. Both are fixed by downloading the bytes server-side while the link is
  still live (`BrowserSession.downloadReplay()`) and storing them under
  `data/replays/<jobId>/<sessionId>.ndjson[.gz]` (`apps/worker/src/replay-store.ts`), served
  back through a new `user_id`-scoped route
  (`apps/web/src/app/api/jobs/[id]/replays/[replayId]/route.ts`) that never sets
  `content-encoding`. `replays` gained `status` / `adapter_id` / `finding_count` /
  `stored_path` / `size_bytes` / `content_type` columns so the dossier can render an honest
  per-source state (`stored` / `link_only` / `empty` / `unavailable` / `too_large`) instead of
  a flat list of links. See `memory/security-invariants.md` ("Stored replays") and
  `memory/architecture.md` ("Replay capture").
- ~~**No retention policy for stored replays.**~~ **Fixed.** `REPLAY_RETENTION_DAYS`
  (`packages/shared/src/env.ts`) bounds how long `data/replays/` keeps a recording;
  `pruneStoredReplays` in `apps/worker/src/replay-store.ts` sweeps once at worker startup —
  the event that actually recurs (`tsx watch` restarts on every source edit) and the one
  moment no job is competing for the directory.

  **The default is `0`, which means keep forever.** Deliberately: a stale recording is
  still good for re-reading what the agent saw, and a default that deletes is a default
  that deletes data the user already has, the first time they restart after an upgrade.
  Retention is opt-IN.

  The ROW always survives a prune — it is what lets a finished dossier still say which
  source recorded and how many findings it contributed — and gets a new
  `status: "expired"`, rendered as "This recording was deleted to save space". That is
  deliberately distinct from `unavailable`: "we deleted this after N days" and "there was
  never anything here" are different facts about a run. The sweep runs every `stored_path`
  through `resolveStoredReplayPath()` before unlinking, because that column is a DB value
  and an unguarded sweep would be a delete primitive pointed at an untrusted string.

- **The "sample data" mark is always on, even for a fully live run.** DONE — fixed with
  option (b). `SourceMode` gained a third value, `"stub"`, and `runAdapters` records it for
  `needsBrowser: false` adapters instead of `"fixture"`. Both consumers already filtered on
  `mode === "fixture"` exactly (`dossier.tsx`, `job-history.tsx`), so the strip and the
  badge now stay quiet on a fully live run; stub sources get a muted `dossier.notSearched`
  line at the foot of the dossier ("Not searched: … not implemented yet"). When `yelp` and
  friends become real (item 2 below) they simply start recording `live`/`fixture` like any
  other adapter and drop out of that line.
- ~~**Make session recording opt-in.**~~ **Done.** Every live session used to launch with
  `recording: true`; the recording captures the search URLs, which encode the user's
  requirements (celiac, allergy, wheelchair, mold) — health / accessibility / housing data
  retained by a third party. Now a per-run choice, default OFF, carried on the job row
  (`jobs.record_session`, migration `0008`) rather than in transport or the env: the poll
  loop can claim a job without ever seeing the HTTP body that created it, so the flag has
  to be persisted. `recordSession` is a `z.boolean().default(false)` on
  `JobCreateInputSchema`, so a client that omits it gets no recording rather than the old
  behaviour. `LaunchOptions.recording` defaults to `false` and rides through the
  `FeatureRequiresPlan` downgrade unchanged; `BrowserSession.recording` lets an opted-out
  session short-circuit `getReplayUrl()` / `downloadReplay()` with no gateway round trip
  and lets `runAdapters` skip replay capture outright — otherwise every opted-out run
  would log a warning about a link that was never going to exist. The dossier's
  `Run details` section distinguishes "recording was off for this run" (`recordSession ===
  false`) from "no replay available on this plan"; `undefined` (a pre-existing row) still
  reads as the latter, because those runs DID record and the column cannot say so. The
  checkbox sits in the form's `Advanced settings` and deliberately does not persist between
  runs — opting in is a per-run decision.

- ~~**Geolocation accuracy is now respected, but the field is still text-first.**~~
  **Resolved by item 5.** A fix wider than 5 km is still refused outright
  (`COARSE_FIX_METERS` in `location-field.tsx`) because a desktop with no GPS answers with
  an IP-derived regional centroid. The reverse geocode now asks for `zoom=14` so a good fix
  names the borough rather than the city, and refuses to answer at all when it cannot name a
  city — it used to fall through to "Quebec, Canada". And the map pin now exists, which
  makes the whole question moot: the user points at the place and `Location.pinned` stops
  everything downstream second-guessing it.

- ~~**Profile a real run before optimising it.**~~ **Done, and acted on.** Job d52c3501:
  total 400s = resolve 5.9s + searches 190.5s + enrich 203.8s, and within searches the LLM
  extraction was 175.7s of the 190.5. So ~90% of a run was LLM calls, strictly sequential.
  Extraction is now batched (8 places per call, 3 concurrent) and enrichment runs 3 places
  at a time in separate tabs of the same session. The per-query and per-adapter timing lines
  stay in the log; re-read them on the next live run and re-tune `STAGE_SHARE` (the progress
  bar's within-adapter split) against the new shape. Remaining serial cost worth a look:
  `SCROLL_SETTLE_MS` is a flat 1.4s wait per scroll round rather than watching for the feed
  to actually grow.
- **Old profiling note (superseded).** `google_maps` now logs a per-query breakdown
  (`nav / feed / scroll / scrape / extract`) and an adapter total (`resolve / searches /
  enrich`). A 347-second run is slow enough to be worth attacking, but which stage owns it
  is invisible from outside: "stuck after feed wait" could be the scroll loop (up to 10
  rounds x 1.4 s) or a single multi-thousand-token extraction. Read those lines off the next
  live run before changing anything. Likely candidates once measured: extraction is one LLM
  call per query over ~30 places, enrichment is up to 10 more, and `SCROLL_SETTLE_MS` is a
  flat wait that could watch for the feed growing instead.
- ~~**A worker restart stranded runs forever.**~~ **Fixed.** A job leaves `running` only in
  the process that claimed it, so a crash, a deploy or `tsx watch` reloading on a source
  edit left the row `running` permanently: the poll loop claims only `queued`, and the
  `JobBudget` that would have timed it out died with the process. `reapAbandonedJobs` in
  `server.ts` now finishes those at startup, with an event row saying why. Sound only
  because Sensitiv runs a single worker — a second concurrent one would reap the first's
  live jobs.

## 2. Second dining source — DONE, but NOT Yelp or Find Me Gluten Free

Both sources this item originally named forbid exactly this. Yelp's robots.txt: "Use of any
robot, spider, service search/retrieval application, or other automated device, process or
means to access, retrieve, copy, scrape, or index any portion of the service or any content
is prohibited". Find Me Gluten Free names `anthropic-ai` / `ClaudeBot` / `Claude-SearchBot`
/ `GPTBot` and friends by user agent and disallows them from every listing path it has
(`/biz`, `/posts`, `/postal`, `/search`, `/map`, and each country prefix including `/ca`
and `/us`). Sensitiv IS one of those agents. Shipping either as a DEFAULT source is a
different thing from a user pointing the tool somewhere themselves, so neither was built.
The two stubs stay stubs.

**`openstreetmap` is the second real source instead** (`apps/worker/src/adapters/
openstreetmap.ts`), read through the Overpass API. It is a different kind of source in
three ways that all matter:

- **Open data, no permission problem.** ODbL, a documented public API, one POST per job
  with a real User-Agent.
- **No LLM and no browser.** The tags ARE the evidence — `diet:gluten_free=only` is a fact
  someone surveyed, not prose to interpret — so extraction is deterministic, free, exact,
  and its quotes are verbatim by construction rather than by `extract.ts`'s substring check
  on model output. `needsBrowser: false`, so it never costs a paid Solari session. It is
  the only adapter that returns REAL results from an entirely empty `.env`.
- **It answers a different question.** Maps knows what a place calls itself and what
  reviewers said; OSM knows what a surveyor recorded about the kitchen and the entrance.
  `Parc Sans Gluten` is tagged `diet:gluten_free=only` AND `wheelchair=no` — perfect on one
  requirement, disqualified on another. That is the shape `conflicted` and the score's
  `corroborated` bonus were built for and had never had a second source to exercise.

Mapping is a lookup table keyed by catalog id (same shape as `REQUIREMENT_TERMS` in the
planner), so an unknown id is simply not researched: `celiac` -> `diet:gluten_free`,
`access` -> `wheelchair`, `diet` -> `diet:halal` / `diet:kosher`. `allergy` and `mold` map
to nothing and the adapter says so rather than inventing a reading. The confidence per tag
value is a real judgement, not decoration: `diet:gluten_free=only` is 0.95 (an entirely GF
venue meets the celiac musts by construction, per the catalog's own `satisfiedByHints`)
while `=yes` is deliberately 0.6, BELOW `EXPLICIT_MARK_CONFIDENCE` — "gluten-free options
available" is not "the kitchen is safe", and scoring the first as the second is the exact
error this app exists to avoid.

Two supporting changes landed with it: `AdapterContext.fetch` (injected; the default
`defaultAdapterFetch()` in `apps/worker/src/http.ts` REFUSES under vitest, the same
fail-closed rule as the Solari module loader) and `AdapterResult.mode`, which lets an
adapter that reads an API report its own `live`/`fixture` instead of being filed as
`"stub"` — i.e. under the dossier's "not implemented yet" line.

Still open here: the `corroborated` bonus and the canonical-key normalisation are now
*reachable* but have not been tuned against a real two-source run. `canonicalKey` keys on
name + first street token, and OSM's `addr:housenumber`/`addr:street` and Google's
formatted address do not always agree. That is the next thing to measure.

Also unbuilt, deliberately: matching a `custom_<slug>` requirement ("Italian") against OSM's
`cuisine` tag. It would help, but it is fuzzy text matching bolted onto an adapter whose
whole value is determinism, and the free-text subject is already answered by the Maps
search itself.

## 3. Make the score granular enough to rank with

The rubric is now five rules (`explicit` +2 / `supported` +1 / `corroborated` +1 /
`contradicted` −2 / `unverified` 0) times a catalog `weight`. That fixed the inversion it
was written for — a dedicated gluten-free restaurant no longer ranks below seven
wheat-flour ones — but it is still coarse: a place either "supports" a requirement or it
does not, so a whole result set lands on a handful of integers and the adapter falls
through to review count to break ties. Nothing distinguishes "89 reviews mention gluten
free" from one passing remark, or a certification from a category string.

Things worth pulling in: the `confidence` the extractor already returns (currently only
used as a >= 0.8 threshold), the review-topic counts the detail page exposes
("mentioned in 89 reviews"), source recency, and the `negativeHints` the catalog declares
and nothing reads yet. Distance from the resolved viewport is the other obvious axis —
the adapter now knows the search centre exactly, and nothing uses it for ranking.

Also still true: `apps/worker/src/merge.ts` has only ever been exercised against one
source. Once item 2 lands, tune the canonical-key normalization against real cross-source
data, and the `corroborated` bonus finally becomes reachable.

## 4. Housing adapters

`kijiji` and `craigslist`, gated by the `mold` → `housing` intent. They are declared in
`packages/shared/catalog/intents.ts` and deliberately **not** registered, so the registry
skips them with a warning. Build them behind the `mold` chip.

## 5. v1.1 location map pin — DONE

`apps/web/src/components/location-map.tsx` (Leaflet, `next/dynamic` with `ssr: false`,
mounted only while the `Disclosure` is open because Leaflet in a `hidden` container renders
a grey box) plus a 1/3/5/10 km radius select in `location-field.tsx`. Click, drag or arrow
keys place the pin; a circle shows the radius; the pin is reverse-geocoded for a NAME only,
so a failed lookup leaves the pin where the user put it.

The load-bearing part is `Location.pinned`. Coordinates were previously always assumed to be
geocoded from text, which is coarser than a postal code by definition, so a postal code beat
them everywhere: `resolveViewport` re-resolved through Google and `runAdapters` withheld the
browser's `geolocation` hint. A pin inverts that — pointing at a spot is finer than naming a
delivery area — so `pinned: true` makes the coordinates win, skips the Maps resolve hop
entirely (one fewer page load) and sends the geolocation hint. Dropping a pin clears the
postal code, and typing a postal code clears the pin: they are rival answers to one
question, and leaving both would let the more specific win silently.

Also fixed here, from the same complaint: `GET /api/geocode` asked Nominatim for `zoom=10`,
which tops out at the CITY, so "Use my location" in the Plateau answered "Montreal" — and a
fix outside any city answered with no city at all, which the label then rendered as
"Quebec, Canada". A province, offered to the user as their location. It now asks for
`zoom=14` (borough + city) and returns `location: null` rather than naming a region it
cannot place.

## 6. Deploy hardening

The BYOK Solari key flow (`sessionStorage` → POST body → worker memory) is **localhost
only**. Before any shared/public deployment: server-only keys, encrypted `user_secrets`
(the table exists and must stay empty until then), and real auth replacing
`getOrCreateLocalUser()` (the schema is already `user_id`-scoped for this).

## Not planned

Auto-contacting restaurants/landlords, payments, a marketplace, medical diagnosis,
auto-booking, hosting other people's API keys, claiming a kitchen is safe.

## Do not remove

`apps/worker/fixtures/` — these back the "runs green with an empty `.env`" acceptance gate
(`apps/worker/test/lifecycle.test.ts`), they are not dead weight.
