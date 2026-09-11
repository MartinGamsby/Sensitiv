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
- **Real Google Maps extraction.** `apps/worker/src/adapters/google-maps.ts` `SCRAPE_FN`
  uses best-guess selectors (`[role="article"]` cards, `aria-label` ratings). Replace with
  selectors that match current Maps DOM; handle the consent interstitial and the
  "showing results in another city" redirect (rewrite the query with neighbourhood +
  region — the failure mode is already noted in the plan).
- **Surface run provenance.** Partly done: the worker now emits `degraded-llm` /
  `degraded-solari` `job_events` (keyed by `source`) and the run page renders an amber
  banner for each (`deriveNotices` in `run-view.tsx`, `run.notice.*` messages). Still
  missing: a *persisted* per-source mode on the `Dossier` (e.g. `sourceModes:
  Record<SourceId, "fixture" | "live">` — needs a `packages/db` migration) so the dossier
  itself is marked "sample data" when reopened from history, not just live.
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
  `memory/architecture.md` ("Replay capture"). No retention policy yet — that is still open.

- **Make session recording opt-in.** Every live session launches with `recording: true`.
  Solari's own docs say recording captures input values; the agent types nothing, but the
  recording still captures the search URLs, which encode the user's requirements (celiac,
  allergy, wheelchair, mold) — health / accessibility / housing data retained by a third
  party. A per-job toggle (default off, on when the user wants a replay link) is the fix;
  it touches the job schema, the new-job form and `launchBrowser`, so it is its own PR.

## 2. Second dining source

Add a real `yelp` **or** `find_me_gluten_free` adapter (both currently register as no-op
stubs that return no findings). This is what proves the cross-source merge / consensus
logic against real data rather than a single fixture.

## 3. Exercise merge + score on real multi-source data

`apps/worker/src/merge.ts` and `score.ts` (the +2/+1/−2/−1 rubric, `conflicted` → amber)
have unit tests but have only ever seen fixtures. Once items 1–2 land, run real jobs and
tune the canonical-key normalization and the scoring weights against what actually comes
back.

## 4. Housing adapters

`kijiji` and `craigslist`, gated by the `mold` → `housing` intent. They are declared in
`packages/shared/catalog/intents.ts` and deliberately **not** registered, so the registry
skips them with a warning. Build them behind the `mold` chip.

## 5. v1.1 location map pin

Leaflet + Nominatim reverse-geocode, click to drop a pin, radius select (1 / 3 / 5 / 10
km). `apps/web/src/components/location-field.tsx` has the `TODO(v1.1)` stub. Text +
optional postal code already ship.

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
