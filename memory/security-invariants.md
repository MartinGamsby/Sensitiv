# Security invariants

Rule → guarding test. Don't relax a rule without moving its test.

## Secrets

- API keys: worker + Next server only; never client bundle, URL, SQLite, events, logs,
  replay metadata. Scrubbed at the sink (`createJobLogger` redact, `jobs.error_text`).
  Tests: `shared/src/env.test.ts`, `db/src/security.test.ts`, `worker/test/runner.test.ts`,
  `web/.../api/jobs/route.test.ts`, `worker/src/browser/solari.test.ts`.
- BYOK: sessionStorage → POST body → worker memory, dropped in the job's `finally`.
- `user_secrets` stays empty until encryption lands.
- Replay URL is a bearer capability: never logged, only its expiry.
- `source_modes_json` holds modes only, nothing invertible to a key.

## Session recording

Opt-in per run, default off (`jobs.record_session`) — search URLs encode health/access/
housing data. `BrowserPage` exposes no typing method; adding one needs this revisited.
Tests: `solari.test.ts`, `runner.test.ts`, `db/src/jobs.test.ts`, `api/jobs/route.test.ts`.

## Stored replays

- Served only via `GET /api/jobs/:id/replays/:replayId`, path from a `user_id`-scoped row
  (`getReplayForJob`, id AND job id), containment via `resolveStoredReplayPath()` — the one
  implementation (`db/src/client.ts`), also used before any unlink.
- Always `attachment` + `nosniff`; content type allowlisted; **never** `content-encoding:
  gzip` (file is already gzip). Gzip detected by magic bytes, not headers.
- `REPLAY_RETENTION_DAYS` default 0 = keep forever; swept at startup; row survives as
  `expired`.
- `data/replays/` gitignored.

## No network in tests

Default Solari loader and `defaultAdapterFetch()` refuse under vitest. Tests:
`solari.test.ts`, `openstreetmap.test.ts`.

## Third-party sources

Default sources must permit automated access — check robots.txt and terms before adding
an adapter. Yelp and Find Me Gluten Free forbid it → `REFUSED_ADAPTER_IDS`.

## SSRF

- Worker fetches (Overpass, Nominatim): hardcoded origins, `redirect: "error"`, timeouts,
  mapped fields only. Overpass mirror: `overpass.private.coffee`.
- `isSafeSiteUrl` (`shared/src/safe-url.ts`, single implementation) for any scraped URL.
  Does not resolve DNS — accepted for single-user localhost.
- `/api/geocode`: fixed origin, range-checked coords, rate-limited, ignores `?url=`.

## Prompt injection

Scraped text fenced as data (`prompts/fence.ts`); LLM output Zod-validated; no tools.
Every quote must appear verbatim in one scraped string leaf (`quoteAppearsIn`,
`worker/src/extract.ts`), after folding only meaningless differences.

## Untrusted URLs in UI

`safeExternalHref()`: http(s) only, else plain text. Applies to place URLs, evidence
sources, `link_only` replays (expired → plain text). Test: `dossier.test.tsx`.

## Place photos

Never an `<img src>` to a third party — proxied via `/api/jobs/:id/places/:key/photo`.
Ownership checked before any fetch; URL from a scoped row, re-validated with
`isSafePhotoUrl`; `redirect: "error"`, 8 s, 5 MB on bytes read; five raster types only —
**never add `image/svg+xml`**; CSP sandbox, nosniff, CORP same-origin.
Test: `photo/route.test.ts`.

## Ownership

All job/event/dossier reads take `user_id`; foreign = missing. `getJobById` is worker-only.
Aggregates derive ids from their own scoped query. Deletes go through the owned job's id,
as one `db.batch` (not a transaction — libsql opens a fresh `:memory:` DB).

`extraction_cache` is the one table without `user_id`: it holds only a hash key and public
listing content. Re-check if a cache entry ever carries user-typed text. It **always
expires** (`EXTRACTION_CACHE_TTL_HOURS`, default 24; writes with TTL ≤ 0 throw; read-time
filter) — a stale safety claim is the risk.

## SQL / worker exposure

Drizzle parameterized queries only, inside `packages/db`. Worker binds `127.0.0.1`, no
auth, rejects any request with an `Origin` header (`worker/src/index.test.ts`).
