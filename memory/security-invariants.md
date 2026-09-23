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
- Solari session recording is **opt-in per run, default off**. It captures input values
  per the Solari docs — including passwords and payment data — and, more relevantly here,
  the **search URLs**, which encode the user's requirements (celiac, allergy, wheelchair,
  mold). That is health / accessibility / housing data on a third party's storage, so the
  user chooses it per run rather than inheriting it from a default.
  - The flag lives on the job row (`jobs.record_session`), not in transport and not in the
    env: the worker poll loop can claim a job without ever seeing the HTTP body that
    created it. `undefined` (a row from before the column) reads as off.
  - `launchBrowser` defaults `recording` to `false`; an opted-out `SolariBrowserSession`
    also short-circuits `getReplayUrl()` / `downloadReplay()` without a gateway round trip,
    and `runAdapters` skips replay capture entirely for it.
  - The agent must still never type a credential into a page. `BrowserPage` deliberately
    exposes no typing method (`goto` / `waitForTimeout` / `evaluate` / `content` / `close`
    only), which is what keeps that true — adding one would need this rule revisited.
  - Guarded by `apps/worker/src/browser/solari.test.ts` ("does not record unless the run
    explicitly opted in", "an opted-out session never asks the gateway for a replay",
    "carries an opted-out recording through the FeatureRequiresPlan downgrade"),
    `apps/worker/test/runner.test.ts` ("an opted-out job never records…"),
    `packages/db/src/jobs.test.ts` and `apps/web/src/app/api/jobs/route.test.ts`
    ("does not record the session unless the body asks for it").
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
- **Retention** is `REPLAY_RETENTION_DAYS`, swept by `pruneStoredReplays` at worker
  startup. It defaults to `0` = keep forever, so nothing is deleted unless the operator
  asks; capture is itself opt-in per run, so this data only exists when it was requested.
  The sweep resolves every `stored_path` through `resolveStoredReplayPath()` before
  unlinking — that column is a DB value, and an unguarded sweep would be a delete
  primitive aimed at an untrusted string. A path that fails containment is NOT deleted;
  only its row is cleared. Guarded by `apps/worker/src/replay-store.test.ts` ("refuses to
  delete a stored_path pointing outside data/replays/").
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

The same rule now covers plain HTTP. `AdapterContext.fetch` is injected by the runner from
`RunJobDeps.fetchImpl ?? defaultAdapterFetch()`, and `defaultAdapterFetch()`
(`apps/worker/src/http.ts`) returns a function that REJECTS under vitest. An adapter that
forgot its injected fetch therefore fails closed instead of quietly calling a real
third-party endpoint from CI and leaving a green suite that secretly needs the internet.
Guarded by `apps/worker/src/adapters/openstreetmap.test.ts` ("the DEFAULT fetch refuses to
reach the network under the test runner").

## Third-party sources: permission, not just capability

`google_maps` and `openstreetmap` are the only real sources, and the second was chosen over
the two the roadmap named because of what those two say about automated agents:

- Yelp's robots.txt prohibits "any robot, spider, service search/retrieval application, or
  other automated device, process or means to access, retrieve, copy, scrape, or index any
  portion of the service or any content".
- Find Me Gluten Free lists `anthropic-ai`, `ClaudeBot`, `Claude-SearchBot`, `GPTBot`,
  `Google-Extended` and others by user agent and disallows every listing path (`/biz`,
  `/posts`, `/postal`, `/search`, `/map`, and each country prefix).

Sensitiv is one of those agents. Both ids now live in `REFUSED_ADAPTER_IDS`
(`packages/shared/catalog/intents.ts`) and the catalog integrity test asserts that **no
intent lists one** — a policy refusal has to be enforced somewhere a future edit trips
over, not only written down here. They were previously registered as no-op adapters, so
every dining run resolved them, "ran" them, recorded a source mode for them, and the
dossier told the reader they were "not implemented yet, so they ran but contributed
nothing" — a decision already taken, reported as a backlog item. Those adapters are
deleted. An id that is merely UNBUILT (`store_locator`, `kijiji`, `craigslist`) may still
be declared: it hits the registry's log-and-skip path and is reported nowhere in the UI.

The rule this establishes: a source shipped as a DEFAULT
is the maintainer's choice, not the user's, so it must be one that permits automated
access. `README.md` already says a user is responsible for sources they point the tool at;
that does not extend to what the registry runs out of the box. Check `robots.txt` and the
terms before adding an adapter.

`openstreetmap` is ODbL open data on a documented public API, identifies itself with a
real User-Agent, and makes one request per job — up to four when the main instance fails with a
retryable error (429/502/503/504, transport, unreadable body): it is retried twice, 2s
apart, and then the one mirror is asked (`OVERPASS_ATTEMPTS`).

## SSRF — the worker's outbound HTTP

`apps/worker/src/adapters/openstreetmap.ts` is the first worker code to `fetch` anything
directly. It follows the same rules as `/api/geocode`: the Overpass and Nominatim origins
are HARDCODED constants (never assembled from job input; the only two Overpass origins are
`overpass-api.de` and the mirror `overpass.private.coffee`, picked as a
privacy-oriented non-profit because the query carries a location and a health tag), `redirect: "error"` so a `302`
cannot walk the request off the allowlisted origin, a wall-clock timeout on every call, and
only mapped fields are read out of the response. Element ids reaching an
`openstreetmap.org/<type>/<id>` URL are Zod-validated non-negative integers.

`website=` tags are free text someone typed into OSM and become an `href` in the dossier,
so they go through `isSafeSiteUrl()` — which moved from `adapters/google-maps.ts` to
`apps/worker/src/util.ts` when the second caller appeared, and again to
`packages/shared/src/safe-url.ts` when the Next photo route became a third, because a
security check copied per call site is a check that drifts. `apps/worker/src/util.ts`
re-exports it, so every adapter import is unchanged. Guarded by `apps/worker/src/adapters/
openstreetmap.test.ts` (`javascript:`, `169.254.169.254`, `localhost`, unparseable).

What `isSafeSiteUrl` does NOT do is resolve DNS, so a public hostname answering
`127.0.0.1` still passes. Accepted rather than overlooked: closing it means resolving and
pinning an address per request, and on a single-user localhost install the payoff is a
page the reader's own browser could already fetch.

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

On top of that, **every quote must actually appear in the scraped content** — the
fabricated-quote guard, `quoteAppearsIn()` in `apps/worker/src/extract.ts`. It matches
against the blob's string LEAVES, never against `JSON.stringify(blob)`: the two differ in
ways the model does not control (a newline is a real newline in the leaf but backslash-n
once stringified, and a double quote picks up a backslash), so the old encoding-level check
threw away honest evidence and logged it as the model's fault. Differences with no meaning
are folded before matching — whitespace runs, curly quotes/dashes, case, and the full-width `＜`/`＞`
`fenceUntrusted` itself substitutes — but never the words or their order, which is what the
guard actually tests. Leaves are matched separately so a quote cannot be stitched together
across two unrelated fields. Guarded by `apps/worker/src/extract.test.ts`
("quoteAppearsIn — the fabricated-quote guard"), whose three regression cases fail against
the old implementation.

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
- **Deleting a run** (`deleteJobForUser`, `packages/db/src/jobs.ts`) checks ownership
  first and returns `undefined` for a foreign or missing job — the same indistinguishable
  answer every other read gives — and every child table it then clears is reached through
  THAT job's own id (or a subquery over its own places), never through a list the caller
  supplied. `DELETE /api/jobs/:id` refuses a `queued`/`running` job with 409: the worker
  is still appending `job_events` against the row with foreign keys ON, so deleting it
  would crash the run rather than cancel it. Stored replay paths go through
  `resolveStoredReplayPath()` before any `unlink` — same reasoning as the retention sweep:
  `stored_path` is a DB value, and an unguarded unlink over one is a delete primitive.
  The six deletes go out as one `db.batch` and NOT `db.transaction`: drizzle's libsql
  driver opens a fresh connection for a transaction, and a fresh connection to `:memory:`
  is a fresh EMPTY database, so every test in `packages/db` would lose its schema
  mid-delete. Guarded by `packages/db/src/jobs.test.ts` and
  `apps/web/src/app/api/jobs/[id]/route.test.ts`.
- `extraction_cache` is the ONE table with no `user_id`, and the exception is
  deliberate rather than an oversight. A row holds a sha-256 key, an adapter id, and what
  a public listing said about a place — no record of who searched, and none of what they
  were looking for, because the requirement set reaches the key only through the hash. Two
  users researching the same restaurant get the same answer and neither learns anything
  about the other. Scoping it by user would leak nothing less and would make the cache
  per-user, which on a single-user install means "useless". The moment real auth lands
  (item 7, `next-steps.md`), re-read this: the reasoning holds only while the stored
  value is public-page content, and would NOT hold if a cache entry ever carried
  free-text the user typed.
- **The cache always expires.** `EXTRACTION_CACHE_TTL_HOURS` (default 24) bounds every
  row; `putCachedExtractions` throws on a non-positive TTL, so there is no code path that
  writes an immortal one, and `getCachedExtractions` filters on `expires_at` at READ time
  rather than trusting the startup sweep. This is the opposite default from
  `REPLAY_RETENTION_DAYS` on purpose: a replay is a recording of what the agent saw and
  ages into history; a cached extraction is a claim about a kitchen and ages into a lie.
  Guarded by `packages/db/src/extraction-cache.test.ts`.
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

## Place photos: proxied, never hotlinked

`places.thumbnail_url` is a URL scraped off a page we did not author, and an `<img src>`
is fetched by the reader's browser with no click in between. The original answer was to
accept only `*.googleusercontent.com` on render — safe, and the reason a place Google had
no photo carousel for showed no picture at all however good the one on its own website.

The rule now: **a stored photo URL is never an `<img src>`.** The page loads every photo
from `GET /api/jobs/:id/places/:key/photo` on our own origin, which is strictly NARROWER
than before; in exchange, the set of hosts a photo may be captured from opens up to any
public https address, which is what lets `og:image` and OSM's `image=` tag be real
fallbacks. The reader's IP, and the fact that they opened this dossier, also stop
reaching the third party.

The route is `apps/web/src/app/api/jobs/[id]/places/[key]/photo/route.ts`:

- Ownership is checked FIRST, through `getJob(db, id, user.id)`, and everything after it
  404s. The outbound request happens only after that, so the route is not a way to make
  our server fetch a URL on a stranger's behalf.
- The URL comes from a `user_id`-scoped DB row (`getPlacePhotoUrl`, keyed by job id AND
  canonical key), never from request input, and is re-validated with `isSafePhotoUrl` —
  the same function the worker used before storing it, because a row written by an older
  build is not evidence that a check once passed.
- `redirect: "error"` (a followed `302` walks off the approved host), an 8 s timeout, a
  5 MB cap enforced on the bytes actually read rather than on a `content-length` a
  hostile host is free to lie about.
- The response content type is an ALLOWLIST of five raster types.
  **`image/svg+xml` is not on it and must not be added** — an SVG is a document that can
  carry script, and serving one from our own origin is stored XSS with extra steps.
  Plus `nosniff`, `content-security-policy: default-src 'none'; sandbox`, and
  `cross-origin-resource-policy: same-origin`.
- Guarded by `apps/web/src/app/api/jobs/[id]/places/[key]/photo/route.test.ts` (cross-user
  404 with no outbound fetch, infrastructure-network URLs, the SVG and HTML pass-through
  refusals, the size cap, the `redirect: "error"` assertion) and by
  `apps/web/src/components/dossier.test.tsx` ("loads a photo through our own origin").

## Worker exposure

The worker binds `127.0.0.1` only and has no auth by design — it holds secrets. Nothing in
the browser talks to it; the browser reads `job_events` through the Next SSE route.
`POST /jobs` refuses any request carrying an `Origin` header: loopback + no auth means a
web page the user has open could otherwise drive it with a preflight-free `text/plain`
POST, and the one legitimate caller (`postJobToWorker`, server-side `fetch`) never sends
that header. Guarded by `apps/worker/src/index.test.ts`.
