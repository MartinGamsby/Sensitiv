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
The live event log says `using recorded fixture (no live browser session)`. Everything
*around* the data is real (planner, cross-source merge, scoring, the Zod-validated dossier,
SSE, persistence) — only the source results are canned. This is the state the automated
acceptance tests lock in.

**Both keys are required for a live run.** A `SOLARI_API_KEY` on its own is not enough: a
live cloud browser is paid and recorded, and with no working `ANTHROPIC_API_KEY` the
planner writes canned queries and extraction cannot read the pages, so the run would spend
Solari usage to produce fixture-quality output. The worker gates the browser on the LLM
actually working and falls back to fixtures instead, saying so on the run page.

Every dossier and every row in **Your runs** carries the provenance the run actually
recorded — which sources were live and which were sample data — so reopening an old run
keeps its mark regardless of what is in `.env` today.

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
amber banner — check it before assuming the key itself is bad. There are three:

| Banner | Means |
|---|---|
| **No Anthropic API key** | No `ANTHROPIC_API_KEY`, or the configured one was rejected. Planning and extraction ran on a stub. |
| **Live browsing skipped** | A Solari key *is* set, but the LLM is not working — so no live browser was opened and no Solari usage was spent. Fix the Anthropic key and re-run. |
| **Solari browser unavailable** | The LLM was working and the browser was tried, but the session could not start. The reason is in the event log just above the banner. |

The banners are replayed from the run's own `job_events`, not from the current `.env`, so
an old run in **Your runs** still shows what happened when it ran.

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
fixture instead. Replays require `recording`; without it the dossier says no replay is
available for that source.

Solari hands out replays as **presigned links that expire in ~15 minutes**, so storing the
link and opening it later from your run history would always fail. Instead the worker
downloads the recording while the link is still live and keeps the bytes locally under
`data/replays/<jobId>/` (gitignored); the dossier links to the app's own
`GET /api/jobs/:id/replays/:replayId` route, which serves them back as a download for as
long as the file is on disk. Each source gets its own row saying what it contributed and
whether a recording was **stored**, only reachable by **link** (still unexpired),
**empty** (the session navigated nowhere), **too large** to keep, or **unavailable**.
Recordings over 25 MB are not stored. There is no retention policy yet — delete
`data/replays/` yourself when you want the space back.

## robots.txt / Terms of Service

Sensitiv drives a **real browser** against third-party sites. Many sites' terms of service
and `robots.txt` restrict automated access. **You are responsible for the sources you point
this at.** Live sources run only when `SOLARI_API_KEY` **and** a working `ANTHROPIC_API_KEY`
are both set (otherwise every adapter is fixture-backed — see "Fake data vs. live runs").
Do not use this to bulk-harvest, and respect rate limits.

## Security notes

- Secrets live in `.env` and are read by the **worker and the web server only** — never
  shipped to the browser bundle.
- Secrets are **never** written to SQLite, logs, or replay metadata, and never placed in a
  URL query string.
- The optional in-browser Solari key field (BYOK) is **sessionStorage-only** and is for
  **localhost development only** — do not run that flow on a shared or public server.
- Downloaded session recordings live in **`data/replays/`** (gitignored). They contain the
  search URLs the agent visited, which encode your requirements — health, accessibility and
  housing data at rest on your own machine. They are served only through the `user_id`-scoped
  replay route, always as an `attachment` with `nosniff`, never rendered inline.

## Not in v1

Accounts / auth UI, payments, marketplace, medical diagnosis, auto-booking, auto-emailing
landlords, hosting other people's API keys, housing adapters (kijiji/craigslist), map pin +
radius search, encrypted `user_secrets`.
