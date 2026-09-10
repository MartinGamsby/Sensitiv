# CLAUDE.md — Sensitiv

## Product one-liner

Sensitiv: given a location + one or more requirements (celiac, food allergy, rental mold,
special diet, wheelchair access), it researches matching places across multiple web sources
with a browser agent and returns a ranked dossier with quoted evidence and replay links.
Not a chatbot — a worker. Research assistance only, not medical, legal or housing advice.

## Shared conventions (apply to every section)

- **Package manager:** pnpm 9+ workspaces. Never npm/yarn. Install from repo root.
- **Node:** 22 (`.nvmrc`, `engines.node: ">=22"`).
- **Language:** TypeScript 5.6, `strict: true`, ESM everywhere (`"type": "module"`).
- **Test runner:** **vitest** only. Per-package `vitest.config.ts`; root `pnpm test` = `pnpm -r --parallel test`.
- **tsconfig:** root `tsconfig.base.json`; every package extends it.
- **Shared package has no build step** — it exports TypeScript source; `apps/web` uses `transpilePackages`, `apps/worker` uses `tsx`.
- **Import alias:** `@sensitiv/shared/<path>`, `@sensitiv/db`.
- **Secrets:** never log, never persist to SQLite, never in a URL query string.
- Windows host; do not hardcode absolute paths in source (`node:path` + repo-relative config).

## Repo layout

```
apps/
  web/       Next.js 15 App Router + Tailwind + next-intl (en/fr). transpilePackages the shared pkg.
  worker/    Long-running Node 22 process. Job runner, adapter registry, Solari plumbing. Run via tsx.
packages/
  shared/    Source-only. catalog/ (intents, requirements), src/schema, src/env, src/llm,
             src/prompts, src/planner.
  db/        Drizzle + libsql SQLite. schema, migrations, seed, repositories.
             The ONLY module that may import drizzle-orm / @libsql/client.
data/        Local SQLite file lives here at runtime; only .gitkeep is tracked.
memory/      Project memory — see memory/memory-map.md.
```

The `BrowserSession` interface and its Solari / fixture implementations live in
`apps/worker/src/browser/` — no other package imports the SDK.

## Rules that bite

- The catalog in `packages/shared/catalog/` is the **source of truth**. Never hardcode
  intent or requirement unions in business logic — look them up.
- The worker is a **long-running Node process, never a route handler**. Next only enqueues.
- Secrets **never** touch SQLite, logs, or replay metadata.
- **Every dossier renders the disclaimer:** "This is research assistance, not medical,
  legal, or housing advice." / « Ceci est une aide à la recherche, et non un avis médical,
  juridique ou immobilier. »
- All job / event / dossier reads are scoped by `user_id` from day one.

## Commands

```
pnpm install
pnpm typecheck        # pnpm -r typecheck
pnpm test             # pnpm -r --parallel test
pnpm lint             # eslint .
pnpm dev              # web (:3000) + worker (:8787) in parallel
pnpm db:migrate       # apply packages/db/migrations
pnpm db:seed          # idempotent; seeds local@sensitiv.dev
pnpm --filter @sensitiv/web build
```

An **empty `.env` is a supported configuration**: the LLM factory falls back to
`FakeLlmProvider` and `launchBrowser` falls back to `FixtureBrowserSession`. Keep it that
way — the test suite depends on it.

## Memory

Start every session by reading `memory/memory-map.md`. It indexes `summary.md` (current
state), `terminology.md` (domain vocabulary), `architecture.md` (how the pieces fit),
`catalog-contract.md`, `security-invariants.md` and `running-and-testing.md`. Keep them
current as part of the change that makes them stale — memory is orientation, not a
changelog.
