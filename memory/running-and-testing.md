# Running and testing

## Commands (always from the repo root, always pnpm)

```
pnpm install
cp .env.example .env      # optional — an EMPTY .env is a supported configuration
pnpm db:migrate           # applies packages/db/migrations to DATABASE_URL
pnpm db:seed              # idempotent; seeds local@sensitiv.dev
pnpm dev                  # apps/web on :3000 + apps/worker on :8787, in parallel
pnpm typecheck            # pnpm -r typecheck
pnpm test                 # pnpm -r --parallel test  (vitest run per package)
pnpm lint                 # eslint .
pnpm --filter @sensitiv/web build
```

Watch one package: `pnpm --filter @sensitiv/shared test -- --watch`.
Regenerate migrations after a schema change: `pnpm --filter @sensitiv/db generate`.

`.env` lives at the repo root and is loaded explicitly by `loadDotEnvFile()`
(`packages/shared/src/env.ts`), called once at each process's entrypoint
(`apps/worker/src/index.ts`, `apps/web/next.config.ts`) — neither Next's own `.env*`
lookup nor the worker's plain `tsx` process reads the monorepo root on their own.
`apps/worker`'s `dev` script watches it (`tsx watch --include ../../.env`) and
self-restarts on a change; `apps/web` does not (Next only watches files it already knows
about) — **fully restart `pnpm dev` after editing `.env`** and confirm with `GET
/api/health` or the worker's `[worker] listening on … — llm …, solari …` boot line.

## Test conventions

- **vitest only.** No node:test, no jest. Each package owns a `vitest.config.ts`.
- Unit tests sit next to the source as `*.test.ts`; cross-module integration tests live in
  the package's `test/` directory.
- `apps/worker` runs with `fileParallelism: false` — those tests bind a loopback port and
  open real (in-memory) libsql databases.
- `apps/web` runs in jsdom; component tests wrap in `test-support/intl.tsx`.
- Zero network calls in tests. `FakeLlmProvider` and `FixtureBrowserSession` are the
  defaults; `fetch` is stubbed where a route needs it. `__setSolariModuleLoader()` is the
  only way to reach the live-client path, and the default loader hard-refuses to import the
  real SDK under the test runner — do not relax that.
- The replay tests are the one place tests touch the real filesystem: `storeReplay()`
  resolves through `findRepoRoot()` (not injectable, on purpose — both apps must agree on
  it), so `apps/worker/src/replay-store.test.ts` and the replay/cross-section blocks in
  `apps/worker/test/runner.test.ts` write under `data/replays/<jobId>/` and delete that
  directory in `afterEach`. `data/replays/` is gitignored.

## The two acceptance gates

**(a) The whole stack runs with an EMPTY `.env`.**
`loadEnv({})` fills every default; `createLlmProvider` falls back to `FakeLlmProvider` with
a single warning; `launchBrowser` returns a `FixtureBrowserSession` when there is no Solari
key, or the `@solarisdk/browser` module fails to load, or the launch itself fails — all
three degrade to fixtures rather than throwing. `@solarisdk/browser` is a real, installed
dependency now; tests drive the module-fails-to-load and launch-fails paths through the
injectable `__setSolariModuleLoader` seam, so the suite still makes no network calls.
Guarded by `packages/shared/src/env.test.ts`, `packages/shared/src/llm/factory.test.ts`,
`apps/worker/src/browser/solari.test.ts`.

**(b) The dummy end-to-end produces a schema-valid dossier with a full lifecycle.**
A `queued` job claimed by the worker poll loop walks `queued -> running -> done|partial`,
stamps `startedAt`/`finishedAt`, and leaves a `Dossier` that re-parses against
`DossierSchema` when read back through the repositories — with a `job_events` trail whose
first row is "job started" and whose last is "job finished: …", strictly ordered by cursor
id.
Guarded by `apps/worker/test/lifecycle.test.ts` and `apps/worker/test/runner.test.ts`.

## Manual demo

`pnpm dev`, open `http://localhost:3000`, submit Plateau-Mont-Royal / H2T / Celiac /
Auto(fr). The run page streams events over SSE and ends on a dossier with the disclaimer.
No API key required.

With an empty `.env` this is **canned data**: the worker never opens a browser, and every
job returns `apps/worker/fixtures/google-maps-plateau.json` no matter what you enter. The
run page shows an amber **"No Anthropic API key"** banner in this case; if a `SOLARI_API_KEY`
is set but the browser still can't start, it shows a **"Solari browser unavailable"** banner
(both driven by `degraded-*` `job_events` → `deriveNotices` in `run-view.tsx`). A real run
needs `ANTHROPIC_API_KEY` **and** `SOLARI_API_KEY` — a `SOLARI_API_KEY` alone is not enough
for a live run: `runJob` gates `launchBrowser` on the LLM actually working
(`llmUnusable` in `apps/worker/src/runner.ts`), because a fake/failed-auth LLM can only
produce canned queries and canned extraction, so a live, paid, recorded browser session on
top of that would be pure waste. That case shows a **"Live browsing skipped"** banner
(`solari-skipped-no-llm`) instead of "Solari browser unavailable" — the latter is reserved for
a working LLM whose browser failed for its own reason. Adapters also declare whether they
need a browser at all (`Adapter.needsBrowser`, default true): the three v1.1 stubs (`yelp`,
`find_me_gluten_free`, `store_locator`) never touch `ctx.browser`, so the runner never launches
one for them — only `google_maps` opens a session. Even with both keys working, the Google
Maps selectors are unverified (see `memory/next-steps.md` item 1).
