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

## Demo video

`pnpm video [id|all]` renders `apps/video/out/<id>.mp4` (~4 min for 52 s at 1080p30);
`pnpm video:studio` previews. Both run `video:assets` first: OSM tiles, photos, Inter and
synthesised sounds into `apps/video/public/cache/` (gitignored; network only on first run).
First render also downloads Remotion's headless Chrome. `video:import <jobId> <id>` needs
the local DB. Tests there are pure (no browser, no network): choreography tests check each
scripted click lands on its target and the camera never cuts.

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
