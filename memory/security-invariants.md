# Security invariants

Each line is a rule plus the test that fails if the rule is broken. Do not relax one
without moving its test.

## Secrets

- `ANTHROPIC_API_KEY` / `SOLARI_API_KEY` are read by the worker and the Next **server**
  only. Never in a client bundle, never in a URL query string.
- A secret is **never** written to SQLite, a `job_events` row, a log line, or replay
  metadata. `redactEnv()` renders keys as `<set>` / `<unset>`; `describeError(err, secret)`
  scrubs the value out of any error text before it is logged.
  - Enforced at the **sink**, not at each call site: `createJobLogger(..., { redact })`
    scrubs every message before it reaches `job_events` or stdout, and `runJob` scrubs
    `jobs.error_text` the same way. Errors raised by adapters and by third-party SDKs
    (whose text we do not control) therefore cannot carry a key into the DB or the SSE
    stream even though those call sites pass the raw error through.
    - `apps/worker/test/runner.test.ts` — an adapter error embedding the key is
      redacted in `job_events`, stdout, and `jobs.error_text`.
  - `packages/shared/src/env.test.ts` — `redactEnv` never leaks a raw value.
  - `packages/db/src/security.test.ts` — no table holds a key or ciphertext.
  - `apps/web/src/app/api/jobs/route.test.ts` — the BYOK key reaches the worker request
    body and nothing else (not the response, the list, the job row, or any log line).
  - `apps/worker/test/runner.test.ts` — the BYOK key never reaches events, any of the eight
    tables, or stdout.
  - `apps/worker/src/browser/solari.test.ts` — a key handed to `launchBrowser` is not
    echoed in the fallback warning (the guarding test is now named for the module failing
    to load, not for the package being absent, since `@solarisdk/browser` is a real
    installed dependency).
- BYOK is **sessionStorage -> POST body -> worker memory for that job only**, dropped in
  the `finally` of the job. Localhost development only; the UI carries that banner and the
  field only appears when the server reports `SOLARI_API_KEY` unset.
- `user_secrets` exists but must stay **empty** in v1 (encryption is deferred).
- Solari session recording captures input values by default, per the Solari docs —
  including passwords and payment data. The worker launches every live session with
  `recording: true` unconditionally, so the agent must never type a credential into a page
  during a research run.

## SSRF — `GET /api/geocode`

Fixed Nominatim origin baked into the route; `lat`/`lng` parsed as numbers and range-checked
(`[-90, 90]` / `[-180, 180]`); no user-supplied URL or host is ever honoured; a request
timeout and a rate limiter apply; only the mapped `Location` fields come back, never the raw
upstream body. Guarded by `apps/web/src/app/api/geocode/route.test.ts`, including a rogue
`?url=http://169.254.169.254/...` that must be ignored.

## Prompt injection

Scraped page text is **untrusted data**. It is fenced and labelled as data by
`packages/shared/src/prompts/fence.ts` before it reaches a prompt, every LLM response is
re-validated with Zod, and the LLM is given no tool or network access. Guarded by
`prompts/fence.test.ts` and the extraction tests.

## SQL

All SQL goes through Drizzle's parameterized query builder inside `packages/db`. No raw
string interpolation of user input. No other package imports `drizzle-orm` or
`@libsql/client`.

## Ownership

Every job / event / dossier read is scoped by `user_id` — `getJob`, `listJobsForUser` and
`getDossier` take it as a required argument, and a foreign job resolves to `undefined`,
indistinguishable from a missing one. The single worker-only exception is `getJobById`,
which is unscoped by design and must never be called from web code.

## Untrusted URLs in the UI

`place.url` / `evidence.sourceUrl` are LLM output over scraped page content and the
schemas do not constrain the scheme. `safeExternalHref()` in
`apps/web/src/components/dossier-place-card.tsx` is the only thing that turns one into an
`href`: absolute `http:` / `https:` only, everything else renders as plain text.
Guarded by `apps/web/src/components/dossier.test.tsx`.

## Worker exposure

The worker binds `127.0.0.1` only and has no auth by design — it holds secrets. Nothing in
the browser talks to it; the browser reads `job_events` through the Next SSE route.
`POST /jobs` refuses any request carrying an `Origin` header: loopback + no auth means a
web page the user has open could otherwise drive it with a preflight-free `text/plain`
POST, and the one legitimate caller (`postJobToWorker`, server-side `fetch`) never sends
that header. Guarded by `apps/worker/src/index.test.ts`.
