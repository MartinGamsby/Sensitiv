A personal investigation agent for food and environment sensitivities.

Not a chatbot. A worker that uses Solari the way Solari is meant to be used

---

## What it does

Given a **location** + one or more **requirements** (celiac, food allergy, rental mold,
special diet, wheelchair access), Sensitiv researches matching places across multiple web
sources with a browser agent and returns a **ranked dossier** with quoted evidence and
replay links. It is a worker, not a conversation.

> **Disclaimer:** This is research assistance, not medical, legal, or housing advice.

## Quick start

```
pnpm install
cp .env.example .env      # Windows: copy .env.example .env  — an EMPTY .env is fine
pnpm db:migrate           # creates data/sensitiv.db from packages/db/migrations
pnpm db:seed              # idempotent; seeds local@sensitiv.dev
pnpm dev                  # apps/web on :3000, apps/worker on :8787
```

Checks: `pnpm typecheck`, `pnpm test` (vitest, every package), `pnpm lint`,
`pnpm --filter @sensitiv/web build`.

## Fake data vs. live runs

**`pnpm dev` with an empty `.env` does not search anything.** With no `SOLARI_API_KEY`,
the worker never opens a browser. Every job — whatever location, requirements, or search
language you enter — returns the **same recorded fixture**: two gluten-free cafés in
Plateau-Mont-Royal, Montréal, from
[`apps/worker/fixtures/google-maps-plateau.json`](apps/worker/fixtures/google-maps-plateau.json).
The live event log says `using recorded fixture (no Solari key)`. Everything *around* the
data is real (planner, cross-source merge, scoring, the Zod-validated dossier, SSE,
persistence) — only the source results are canned. This is the state the automated
acceptance tests lock in.

**To attempt a live run:**

```
# .env
ANTHROPIC_API_KEY=sk-ant-...
SOLARI_API_KEY=slr_live_...      # Solari Starter plan or better — see the caveat below
```

```
pnpm dev      # then submit a job at http://localhost:3000
```

`.env` lives at the **repo root** (not inside `apps/web/` or `apps/worker/`) — one file for
both processes, loaded explicitly at startup (`loadDotEnvFile()` in
[`packages/shared/src/env.ts`](packages/shared/src/env.ts)), since neither Next's own
`.env*` lookup (which only covers `apps/web/`) nor the worker's plain `tsx` process reads
the monorepo root on their own.

**apps/worker** auto-restarts when `.env` changes (`tsx watch --include ../../.env`), so
editing it while `pnpm dev` is running is enough on that side. **apps/web** does not — Next
doesn't watch a file it doesn't know about, so if a key still isn't taking effect, **fully
stop and restart `pnpm dev`** and check both processes picked it up:

```
curl -s http://localhost:3000/api/health          # {"solari":bool,"llm":"anthropic"|"fake"}
```

or read the worker's own boot line in its terminal output:
`[worker] listening on … — llm anthropic|fake, solari live|fixtures, poll on|off`.

The worker now launches a Solari browser and hits Google Maps for real. If a key you
configured still results in fixture-backed output, the run page will tell you why with an
amber banner (see below) — check it before assuming the key itself is bad.

> **Caveat — the live path has not been exercised end-to-end yet.** The `@solarisdk/browser`
> client shape in [`apps/worker/src/browser/solari.ts`](apps/worker/src/browser/solari.ts)
> is now verified against the real, installed package (`0.1.4`) and its published types —
> only the Google Maps DOM selectors in
> [`apps/worker/src/adapters/google-maps.ts`](apps/worker/src/adapters/google-maps.ts)
> remain best-guess. If a selector is wrong, or the Solari launch itself fails, the run logs
> a warning and falls back to the fixture. Making a real search work end-to-end is the first
> item in [`memory/next-steps.md`](memory/next-steps.md).

## Stack

- **`apps/web`** — Next.js 15 (App Router) + Tailwind + next-intl (en/fr). Validates and
  enqueues jobs, streams `job_events` to the browser as SSE, renders the dossier. Never
  runs a job in a route handler.
- **`apps/worker`** — long-running Node 22 process that executes research jobs. Loopback
  HTTP (`POST /jobs`, `GET /healthz`) plus an optional queued-job poll loop.
- **`packages/shared`** — source-only package: the intent/requirement catalog, Zod
  schemas, the env loader, the LLM provider interface and the planner. No build step.
- **`packages/db`** — Drizzle ORM + libsql SQLite schema, migrations, seed and the typed
  repositories. The only module in the repo that talks to SQLite.

## Solari Starter-plan caveat

The agent requests `stealth`, `captcha`, `recording` and `proxy` options when it launches a
browser session. **These are not all available on every Solari plan — notably Starter.**
A plan-gated option surfaces as a `FeatureRequiresPlan` error; the run **downgrades once**
(dropping stealth/captcha/proxy, keeping `recording`) and retries, so results on a Starter
key may be thinner, unrecorded, or blocked more often. Any other Solari error (concurrency
limits, an unhealthy browser, a bad session id) is not retried — the run falls back to the
fixture instead. Replay URLs require `recording`; without it the dossier shows no replay
link for that source. A replay URL is also **temporary** — it is a presigned link that
expires, so an old link in the run history can eventually stop working.

## robots.txt / Terms of Service

Sensitiv drives a **real browser** against third-party sites. Many sites' terms of service
and `robots.txt` restrict automated access. **You are responsible for the sources you point
this at.** Live sources run only when `SOLARI_API_KEY` is set (otherwise every adapter is
fixture-backed — see "Fake data vs. live runs"). Do not use this to bulk-harvest, and
respect rate limits.

## Security notes

- Secrets live in `.env` and are read by the **worker and the web server only** — never
  shipped to the browser bundle.
- Secrets are **never** written to SQLite, logs, or replay metadata, and never placed in a
  URL query string.
- The optional in-browser Solari key field (BYOK) is **sessionStorage-only** and is for
  **localhost development only** — do not run that flow on a shared or public server.

## Not in v1

Accounts / auth UI, payments, marketplace, medical diagnosis, auto-booking, auto-emailing
landlords, hosting other people's API keys, housing adapters (kijiji/craigslist), map pin +
radius search, encrypted `user_secrets`.
