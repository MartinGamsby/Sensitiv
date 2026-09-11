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
- **Replay links expire.** `sessions.getReplayUrl()` returns a presigned URL with an
  `expiresInSeconds`, but `replays.replay_url` stores it forever and the history UI renders
  it unconditionally, so an old replay link will eventually 403. Fix by persisting the
  Solari session id instead of the URL and minting the replay URL on demand — needs a
  `packages/db` migration, so this pairs naturally with the "Surface run provenance" bullet
  above. (The related *availability* gap — the URL is only minted ~1-3s after the session is
  released — is handled: `SolariBrowserSession.getReplayUrl()` now polls that window. Whether
  the window is wide enough is unverified against a live key.)

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
