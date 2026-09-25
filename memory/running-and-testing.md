# Running and testing

Commands are in `CLAUDE.md`. Extras: `pnpm --filter @sensitiv/db generate` after a schema
change; `pnpm --filter <pkg> test -- --watch`.

## `.env`

Root `.env` is loaded by `loadDotEnvFile()` at each entrypoint. The worker restarts on
change; Next does not — **restart `pnpm dev` after editing `.env`**, confirm via
`/api/health` or the worker boot line.

A live run needs both `ANTHROPIC_API_KEY` and `SOLARI_API_KEY`; Solari alone is skipped
(banner: "Live browsing skipped"). Empty `.env`: `google_maps` serves
`fixtures/google-maps-plateau.json` for every input (canned); OSM is live.

## Conventions

- vitest only; unit tests beside source, integration in `test/`.
- `apps/worker`: `fileParallelism: false` (loopback ports, libsql).
- `apps/web`: jsdom, wrap in `test-support/intl.tsx`; `next/navigation` is mocked in
  `vitest.setup.ts` — open a place with `setSearchParams("place=<key>")`.
- Zero network. Replay tests write under `data/replays/<jobId>/` and clean up.

## Acceptance gates

1. Empty `.env` runs the whole stack (`env.test.ts`, `llm/factory.test.ts`,
   `solari.test.ts`).
2. Dummy end-to-end: queued → running → done|partial, schema-valid dossier, ordered events
   (`worker/test/lifecycle.test.ts`, `runner.test.ts`).

`apps/worker/fixtures/` backs gate 1 — do not delete.
