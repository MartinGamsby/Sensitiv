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
- **Verify the Solari SDK.** `apps/worker/src/browser/solari.ts` is written against a
  *speculative* `@solarisdk/browser` shape (guessed `createClient` / `Solari` /
  `client.launch` / `sessions.getReplayUrl`). Check it against the real SDK docs, install
  the package, fix the client/launch/replay wiring, keep the dynamic-import + fixture
  fallback.
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
