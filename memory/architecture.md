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
4. `GET /api/jobs/:id` returns the assembled `Dossier`.

## The agent loop (`apps/worker/src/runner.ts`)

`markJobRunning` -> user defaults -> location -> resolve search language -> `plan()` ->
union adapters from the planned intents (`adapterIdsFor`) -> run adapters, at most
`MAX_CONCURRENT_BROWSERS` (3) at a time, each with its own `BrowserSession` -> extract ->
Zod -> evidence -> `mergeFindings` on the canonical key -> `scorePlace` -> `writeDossier`
-> attach replay metadata -> `finishJob`.

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
