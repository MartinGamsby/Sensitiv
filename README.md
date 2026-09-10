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

Sensitiv runs with an **empty `.env`**: it falls back to a fake LLM provider and
fixture-backed adapters, so `pnpm install && pnpm typecheck && pnpm test` and the demo
loop all work with zero credentials. `ANTHROPIC_API_KEY` and `SOLARI_API_KEY` only unlock
live runs.

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
Unavailable options are logged and the run **downgrades** rather than failing, so results on
a Starter key may be thinner, unrecorded, or blocked more often. Replay URLs require
`recording`; without it the dossier shows no replay link for that source.

## robots.txt / Terms of Service

Sensitiv drives a **real browser** against third-party sites. Many sites' terms of service
and `robots.txt` restrict automated access. **You are responsible for the sources you point
this at.** Adapters ship fixture-backed by default; enabling a live source is an explicit
opt-in. Do not use this to bulk-harvest, and respect rate limits.

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
