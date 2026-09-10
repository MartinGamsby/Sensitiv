# Project summary

## What this is

Greenfield scaffold. v1 target: a **local, single-user research agent** that installs,
type-checks and runs an end-to-end demo loop (form -> dummy worker job -> streamed events ->
dossier) with **no live API keys**.

## Shipped in this run

- Section 1 - monorepo foundation: pnpm workspace, `tsconfig.base.json`, `.gitignore`,
  `.env.example`, `.nvmrc`, prettier + eslint-lite, `README.md`, `CLAUDE.md`, `memory/`.
  Empty-but-running `apps/web` (Next 15 placeholder page), `apps/worker` (tsx entry that
  logs `worker up` and exits 0), `packages/shared` (exports map + smoke test).

## Deferred

- `TODO(v1.1)` only: housing adapters (kijiji, craigslist), Leaflet map pin + radius
  search, real auth, `user_secrets` encryption, extra requirement packs.
- Later sections in this run: shared schemas/env loader (2), catalog (3), `packages/db`
  (4), LLM provider + prompts (5), planner (6), worker job runner (7), web API routes (8),
  web i18n UI (9).
