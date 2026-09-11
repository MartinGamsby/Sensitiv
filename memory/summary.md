# Project summary

## What this is

Sensitiv v1: a **local, single-user research agent**. A location + one or more requirements
go in; a ranked **dossier** of places with quoted evidence comes out. It is a worker, not a
chatbot.

The whole loop runs with an **empty `.env`** — a fake LLM provider and fixture-backed
browser sessions stand in for Anthropic and Solari — so install, typecheck, test and the
browser demo all work with zero credentials.

## What exists

pnpm workspace, Node >= 22, TypeScript 5.6 strict ESM, vitest everywhere. No build step
except `apps/web`.

- **`packages/shared`** — source-only, no build. `catalog/` (intents, requirements, lookup
  helpers), `src/schema/` (Zod-first `Location`, `SearchLanguage`, `PlannedRequirement`,
  `PlaceDetail`, `PlaceSource`, `Evidence`, `JobEvent`, `Dossier`), `src/env.ts`
  (`loadEnv` + `redactEnv`), `src/llm/` (`LlmProvider`, `AnthropicProvider`,
  `OpenAiProvider` stub, `FakeLlmProvider`, `createLlmProvider` factory), `src/prompts/`
  (system prompt + untrusted-content fencing), `src/planner/` (`plan()`).
  `ai`/`@ai-sdk/anthropic` are pinned to v7/v4 (bumped from v4/v1) — the older `ai@4.x`
  unconditionally injected `temperature: 0` into every `generateObject` call with no way
  to omit it, and `DEFAULT_ANTHROPIC_MODEL` (`claude-sonnet-5`) rejects that parameter
  outright (400 `` `temperature` is deprecated for this model ``), so every real call
  failed — verified live, fixed by both the version bump and no longer passing
  `temperature` from `AnthropicProvider`. `StructuredArgs.temperature` is still in the
  type (other providers may honour it) but `AnthropicProvider` always ignores it.
- **`packages/db`** — the only module that touches SQLite (Drizzle + `@libsql/client`).
  Tables: `users`, `user_secrets`, `jobs` (now with `source_modes_json`, Section 3),
  `job_events`, `places`, `place_sources`, `evidence`, `replays`. Checked-in migrations,
  `migrate`/`seed` scripts, and the typed repositories every other package calls —
  including `listJobSummariesForUser`, the one grouped History-list query.
- **`apps/worker`** — long-running Node process. Loopback HTTP (`POST /jobs`,
  `GET /healthz`), an optional queued-job poll loop, the agent loop in `src/runner.ts`,
  the adapter registry, `BrowserSession` + `FixtureBrowserSession`, merge/score/dossier.
- **`apps/web`** — Next 15 App Router + Tailwind + next-intl (en/fr). API routes
  (`POST/GET /api/jobs`, `GET /api/jobs/:id`, `GET /api/jobs/:id/events` SSE,
  `GET /api/geocode`, `PATCH /api/settings`, `GET /api/health` — booleans only, which is
  how the UI decides whether to show the BYOK field) and the form / run / history UI.
  `apps/web/src/components/ui/` is a small UI primitives layer (`Card`, `Badge`, `MetaRow`,
  `Stack`, `EmptyState`, plus `src/lib/cn.ts`) built on Tailwind with `clsx`/`tailwind-merge`
  — the shadcn/ui *pattern* (owned-in-repo, composable, variant-prop components), not its
  CLI generator: no `components.json`, no Radix, no CSS-variable theming migration. Radix
  primitives can be layered on top later if a real dialog/menu/tooltip is ever needed.
  `tailwind.config.ts` defines semantic tone tokens (`neutral`/`ok`/`warn`/`danger`/`info`,
  each aliasing an existing Tailwind color scale so computed colors are unchanged) plus flat
  structural tokens (`surface`, `surface-muted`, `border-subtle`, `fg`, `fg-muted`). The five
  existing UI components (`dossier.tsx`, `dossier-place-card.tsx`, `job-history.tsx`,
  `run-view.tsx`, `event-log.tsx`) are built on these primitives instead of duplicating
  `Record<string, string>` class lookups per file.

## Where the seams are

- `LlmProvider` — swap in `FakeLlmProvider` (the empty-`.env` default).
- `BrowserSession` — swap in `FixtureBrowserSession` (the empty-`.env` default).
- `RunJobDeps` on `runJob` — inject registry, llm, browser factory, logger, timeout.
- `__setWebDeps()` in `apps/web/src/server/deps.ts` — inject db, env and `fetch` into
  route handlers.

## Deferred

Priority-ordered roadmap is in `memory/next-steps.md`. In brief:

- **No live search yet.** With an empty `.env` the worker never opens a browser — every
  job returns `apps/worker/fixtures/google-maps-plateau.json` regardless of input. The
  `@solarisdk/browser` SDK shape is now verified and installed (pinned `0.1.4`, the real
  `Solari` class, dynamic import + fixture fallback retained); what's still unverified on
  the live path is the Google Maps selectors, and no live run has been exercised
  end-to-end yet.
- Housing adapters (`kijiji`, `craigslist`) — declared in the catalog, skipped by the
  registry with a warning. The `yelp`, `find_me_gluten_free` and `store_locator` adapters
  register but are stubs that return no findings.
- Leaflet map pin + radius search, real auth, `user_secrets` encryption (the table exists
  and must stay empty in v1), extra requirement packs.
