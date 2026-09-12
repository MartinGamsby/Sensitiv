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
  during a research run. `BrowserPage` deliberately exposes no typing method
  (`goto` / `waitForTimeout` / `evaluate` / `content` / `close` only), which is what keeps
  that true — adding one would need this rule revisited.
  - The recording still captures the **search URLs**, and those encode the user's
    requirements (celiac, allergy, wheelchair, mold). That is health / accessibility /
    housing data sitting on a third party's storage for the life of the session. Accepted
    for v1; making `recording` opt-in is in `memory/next-steps.md`.
- The **replay URL is a presigned bearer capability**, not an identifier: anyone holding the
  link can watch the recording until it expires. It is persisted in `replays.replay_url`
  (reads are `user_id`-scoped through `getDossier`) and must never be written to a log line
  or a `job_events` row — `SolariBrowserSession.getReplayUrl` logs the **expiry only**.

## Third-party URLs from the browser gateway

The replay URL is third-party output and `DossierReplaySchema.url` is a bare
`z.string().optional()`, so it gets the same treatment as LLM-authored URLs: a hostile or
compromised gateway response answering `javascript:…` must not become a stored,
click-to-run XSS on the dossier page. Two gates, both required:
`safeReplayUrl()` in `apps/worker/src/browser/solari.ts` (absolute `http:` / `https:` only —
nothing else ever reaches SQLite) and `safeExternalHref()` in the UI, which
`apps/web/src/components/dossier.tsx` applies to a `link_only` replay's `url` exactly as
`dossier-place-card.tsx` applies it to `place.url`. An expired `url` (`expiresAt` in the
past) renders as plain text, never a link, even when the scheme is safe. Guarded by
`apps/worker/src/browser/solari.test.ts` and `apps/web/src/components/dossier.test.tsx`.

## Stored replays (Section 2)

The presigned Solari replay link expires in ~900s and was previously persisted forever and
rendered unconditionally, so opening a dossier from History later followed a dead link. The
fix downloads the recording server-side while the link is still live and stores the bytes
locally, under `data/replays/<jobId>/<sessionId>.ndjson[.gz]`:

- A stored replay is served **only** through `GET /api/jobs/:id/replays/:replayId`
  (`apps/web/src/app/api/jobs/[id]/replays/[replayId]/route.ts`), which resolves the file
  path from a `user_id`-scoped DB row (`getReplayForJob`, looked up by id AND job id — never
  a bare replay id from the request) and asserts the resolved absolute path stays under
  `data/replays/` before any read. No request input ever reaches a filesystem path.
- The containment check has exactly ONE implementation: `resolveStoredReplayPath()` in
  `packages/db/src/client.ts`, next to `findRepoRoot()` and `replaysRoot()`. The worker
  (which writes recordings) and the download route (which reads them) both call it — a
  security check copied into each app is a check that drifts. Guarded by
  `packages/db/src/client.test.ts`.
- The response is always `content-disposition: attachment` + `x-content-type-options:
  nosniff`, never inline, never `text/html` — `content_type` is a free-text column, so the
  route echoes it only when it is one of the two values `storeReplay()` can write and falls
  back to `application/x-ndjson` otherwise. **Never** `content-encoding: gzip` on our own
  response — the stored `.gz` file is already gzip on disk; setting the header would make
  the browser transparently decompress it AGAIN while still naming the download
  `.ndjson.gz`, which is the exact bug (cause 2) this change fixes.
- Node's `fetch` (undici) auto-decompresses a `Content-Encoding: gzip` upstream response, so
  `SolariBrowserSession.downloadReplay()` may receive either gzip bytes or plain NDJSON from
  the SDK — the magic bytes (`0x1f 0x8b`) are sniffed on the returned buffer, the header is
  never trusted.
- The presigned replay URL remains a bearer capability: never logged, never in a
  `job_events` row — only its expiry is (unchanged from before this section;
  `downloadReplay()` follows the same rule: never logs the URL, only status/size on failure).
- `data/replays/` is gitignored. The recordings hold the same search-URL-encoded
  health/accessibility/housing data noted above, now at rest on the local host instead of a
  third party's storage — strictly less exposure, but new data at rest, so it stays out of
  git and is served only through the scoped route above.
- Guarded by `packages/db/src/results.test.ts` (`getReplayForJob` ownership), `apps/web/src/app/api/jobs/[id]/replays/[replayId]/route.test.ts`
  (cross-user 404, non-`stored` 404, path-escape 404, and the missing-`content-encoding`
  assertion), and `apps/worker/src/browser/solari.test.ts` (gzip sniffing, the size cap, and
  that the URL never appears in a `downloadReplay` failure log).

## Network in tests

`@solarisdk/browser` is a real installed dependency and `runJob` reads `SOLARI_API_KEY`
from `process.env`, so a machine with a real key exported could have a test open a real,
billable, recorded Solari session. The default module loader in `solari.ts` therefore
**fails closed** when `process.env.VITEST` / `NODE_ENV=test` is set: the live path is only
reachable through an injected `__setSolariModuleLoader()` stub. Guarded by
`apps/worker/src/browser/solari.test.ts` ("the DEFAULT loader refuses to reach the network").

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

- `listJobSummariesForUser` (Section 3, `packages/db/src/results.ts`) is the History list's
  aggregate query over `places`. It derives the job ids it queries from its own call to
  `listJobsForUser(db, userId, …)` — never from a client-supplied list — so the `places`
  lookup can never widen the boundary the job lookup already enforced. Guarded by
  `packages/db/src/results.test.ts` ("never returns another user's job, even indirectly
  via place data") and `apps/web/src/app/api/jobs/route.test.ts`.
- `jobs.source_modes_json` (`sourceModes` on `Job`/`Dossier`) records *modes*
  (`"fixture" | "live"`) only — never a key value, never whether a key is present, in any
  form that could be inverted into a secret. It rides through the same `user_id`-scoped
  reads as the rest of the job/dossier.

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
