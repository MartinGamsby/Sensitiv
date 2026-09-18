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
  (system prompt + untrusted-content fencing), `src/planner/` (`plan()`),
  `src/schema/score.ts` (the score's VOCABULARY — `ScoreLine`, the two constants that
  bound a score, `maxAchievableScore`, `scorePercent` — shared so the dossier can EXPLAIN
  a score without re-deriving it; the rubric itself stays in the worker).
  `ai`/`@ai-sdk/anthropic` are pinned to v7/v4 (bumped from v4/v1) — the older `ai@4.x`
  unconditionally injected `temperature: 0` into every `generateObject` call with no way
  to omit it, and `DEFAULT_ANTHROPIC_MODEL` (`claude-sonnet-5`) rejects that parameter
  outright (400 `` `temperature` is deprecated for this model ``), so every real call
  failed — verified live, fixed by both the version bump and no longer passing
  `temperature` from `AnthropicProvider`. `StructuredArgs.temperature` is still in the
  type (other providers may honour it) but `AnthropicProvider` always ignores it.
- **`packages/db`** — the only module that touches SQLite (Drizzle + `@libsql/client`).
  Tables: `users`, `user_secrets`, `jobs` (now with `source_modes_json`, Section 3),
  `job_events`, `places`, `place_sources`, `evidence`, `replays` (now with `adapter_id`,
  `finding_count`, `status`, `stored_path`, `size_bytes`, `content_type`, Section 2 —
  migrations `0001`+`0002`; `0003` adds the `jobs` column; `0004` adds
  `job_events.progress_json`, the run-phase marker the progress bar reads; `0008` adds
  `jobs.record_session`, the per-run opt-in that decides whether Solari records the
  browser sessions at all — default off, see `memory/security-invariants.md`). Every new
  column is nullable and
  every reader treats `NULL` as "not recorded", never as `live`/`0`. `0009` adds
  `places.score_breakdown_json`, the per-rule explanation that sums to `score` — stored
  rather than recomputed, so what a reader expands is what actually produced the ranking.
  Checked-in migrations,
  `migrate`/`seed` scripts, and the typed repositories every other package calls —
  including `listJobSummariesForUser`, the one grouped History-list query,
  `recentRunDurationsForUser` (the sample the run page's ETA is a median of), and
  `getReplayForJob`, which is scoped by replay id AND job id.
- **`apps/worker`** — long-running Node process. Loopback HTTP (`POST /jobs`,
  `GET /healthz`), an optional queued-job poll loop, the agent loop in `src/runner.ts`,
  the adapter registry, `BrowserSession` + `FixtureBrowserSession`, merge/score/dossier.
  TWO real adapters now: `google_maps` (browser, LLM extraction) and `openstreetmap`
  (Overpass API, `needsBrowser: false`, deterministic tag->evidence with no LLM call — the
  only source that returns real results from an empty `.env`). `src/http.ts` is the
  outbound-HTTP seam, injected as `AdapterContext.fetch` and failing closed under vitest.
- **`apps/web`** — Next 15 App Router + Tailwind + next-intl (en/fr). API routes
  (`POST/GET /api/jobs`, `GET/DELETE /api/jobs/:id`, `GET /api/jobs/:id/events` SSE,
  `GET /api/jobs/:id/replays/:replayId` — the only reader of stored replay bytes,
  `GET /api/jobs/:id/places/:key/photo` — the only reader of a place photo, which is
  fetched server-side so nothing third-party is ever an `<img src>`,
  `GET /api/geocode`, `PATCH /api/settings`, `GET /api/health` — booleans only, which is
  how the UI decides whether to show the BYOK field) and the form / run / history UI.
  `apps/web/src/components/ui/` is the owned-in-repo primitives layer — `Card`, `Badge`,
  `MetaRow`, `Stack`, `EmptyState`, `Button`, `Field`/`Input`/`Textarea`/`Select`,
  `Disclosure`, `SectionHeading`, `Spinner`/`LiveDot`, `icon.tsx` (hand-rolled stroke SVGs,
  all `aria-hidden`), `flag.tsx` (two inline SVG flags for the locale switch — emoji flags
  have no glyph on Windows, which is the dev platform) plus `src/lib/cn.ts`. It follows the shadcn/ui *pattern* (composable,
  variant-prop components on Tailwind), not its CLI generator: no `components.json`, no
  Radix. Radix can be layered on later if a real dialog/menu/tooltip is ever needed.
  **Theming:** `globals.css` holds the token layer — CSS custom properties as
  space-separated RGB channels (`--surface`, `--fg-muted`, `--brand`, `--ring`, …);
  `tailwind.config.ts` maps them to alpha-aware colors (`bg-surface`, `text-fg-muted`,
  `bg-brand/25`), so most components no longer carry a `dark:` twin per colour.
  Dark is reachable three ways in priority order — `<html data-theme="dark">` (the header
  switch), `prefers-color-scheme: dark` with no `data-theme="light"` (the OS, and the
  no-JavaScript case), else light. The `darkMode` variant in `tailwind.config.ts` resolves
  the SAME two selectors, because a `dark:` utility firing over a light `--surface` is
  worse than no dark mode. The choice lives in `localStorage` (`sensitiv.theme`), not on
  the user row: it belongs to the screen you are reading on, and a pre-paint inline script
  in `[locale]/layout.tsx` reads it synchronously so a navigation never flashes white.
  "Match system" removes the attribute rather than resolving it, so the page keeps
  tracking the OS after load.
  **Everything the server inlines about the theme lives in `src/lib/theme.ts`, which is
  deliberately NOT a `"use client"` module.** A value imported from a client module into a
  server component is a client REFERENCE, not the value: the key was briefly imported from
  `theme-switcher.tsx`, `JSON.stringify` of it produced `undefined`, and the shipped script
  read `localStorage.getItem(undefined)` — so the theme never survived a page load at all.
  `themeBootstrapScript()` is a function so there is something to assert on
  (`theme-switcher.test.tsx`). `ThemeSwitcher`'s mount effect APPLIES the stored theme as
  well as reading it, because switching locale re-mounts the root layout and the pre-paint
  script only runs on a full document load.
  The match pill is the one coloured-by-value element: `MatchPill` sets an inline
  `--match-h` (`percent * 1.2`, so red at 0 through orange and yellow to green at 100) and
  `.match-pill` in `globals.css` turns it into a background/foreground pair per theme. It
  is not a `Badge` tone because tones must be whole literal class strings for Tailwind's
  content scan and a per-place hue is not one; it borrows `BADGE_SIZE_CLASS` so the pill
  geometry has one source. The two colour pairs clear 5.0:1 (light) and 6.7:1 (dark) at
  their worst hue across the ramp — re-check the worst point, not the ends, if they change. Tone families (`neutral`/`ok`/`warn`/`danger`/`info`) still alias
  Tailwind scales. Brand is teal; emerald stays reserved for "sources agree".
  **Layout contract:** the landing form is three numbered step cards with search language /
  timeout folded into an `Advanced settings` `Disclosure`; the run view puts the dossier
  *above* the activity log, which now starts collapsed ALWAYS — live or finished — because
  the progress bar in the status header carries the "is it moving" signal the open log used
  to, and stays open once a reader opens it. **A place card is a shortlist entry first:**
  the header carries only rank, photo, name, address, category and the match percentage —
  plus a conflict badge, the one fact not allowed to wait for a click — and everything
  else (score breakdown, source chips, per-requirement excerpts, red flags, website) sits
  in a panel behind it, collapsed by default. Inside that panel a requirement still shows
  one lead excerpt with the rest behind a nested `Disclosure`. Replays sit in a collapsed
  `Run details` section. Every card renders a photo-sized element whether or not a photo
  exists — `PlacePhoto` falls back to an initials tile hued from the name — because a
  missing image element made titles start at different x positions down the list.
  A finished run can be deleted from History behind an inline two-step confirmation
  (`DELETE /api/jobs/:id`); the extraction cache deliberately survives, and the panel says
  so. A queued or running job is refused with 409 rather than pulled out from under the
  worker. `Disclosure` hides with the `hidden` attribute
  rather than unmounting — collapsed content stays in the DOM (so `querySelector` assertions
  and in-page search still find it) while correctly leaving the accessibility tree.
  The disclaimer is deliberately rendered outside every collapsible section.

## Where the seams are

- `LlmProvider` — swap in `FakeLlmProvider` (the empty-`.env` default).
- `BrowserSession` — swap in `FixtureBrowserSession` (the empty-`.env` default).
- `RunJobDeps` on `runJob` — inject registry, llm, browser factory, logger, timeout.
- `__setWebDeps()` in `apps/web/src/server/deps.ts` — inject db, env and `fetch` into
  route handlers.

## Deferred

Priority-ordered roadmap is in `memory/next-steps.md`. In brief:

- **No live search yet with an empty `.env`.** The worker never opens a browser — every
  job returns `apps/worker/fixtures/google-maps-plateau.json` regardless of input. The
  `@solarisdk/browser` SDK shape is verified and installed (pinned `0.1.4`, the real
  `Solari` class, dynamic import + fixture fallback retained). Live runs HAVE now been
  exercised end-to-end; the location / depth / evidence problems they exposed are fixed
  (see `architecture.md`). What is still only verified by hand, not by a live run, is the
  enrichment pass: Maps detail pages and the website hop were probed in a browser but have
  not yet run through a real Solari session.
- **Scoring granularity is the next known gap** — tracked as item 3 in `next-steps.md`.
  The score's PRESENTATION is done (`Match NN%` over a per-run ceiling, with the stored
  breakdown behind a click); the rubric behind it is unchanged.
- **The extraction cache is the one cache in the repo** (`extraction_cache`, migration
  `0010`): a re-run asks the model only about places it has not already read, and the
  misses are what reaches the prompt. Every row expires —
  `EXTRACTION_CACHE_TTL_HOURS`, default 24, `0` disables, and there is no "forever".
  Anthropic prompt caching was measured and deliberately NOT built: the extraction system
  prompt is 923 tokens against `claude-sonnet-5`'s 1024-token minimum, so a breakpoint
  would silently never engage. The LLM is still ~85% of a run on a cold one (measured:
  92.9s of extraction inside a 110s search stage, plus a 65s enrich stage, in a 3:01 run).
  Item 4 in `next-steps.md`.
- **The dossier is capped at 15 places** (`MAX_DOSSIER_PLACES`, applied in `writeDossier`
  after scoring and before persisting). Runs written before the cap keep the places they
  already stored — it is a write-time rule, not a read-time filter.
- **Live runs now work end to end.** Job 78e1bdfb resolved H1S to 45.5820,-73.5829, scrolled
  one query from 7 results to 33, and enriched six places off their detail pages and
  websites. What has NOT been re-run live since the fixes that followed it: all-queries,
  rank-before-cap, restriction-only enrichment, the progress model and thumbnails are
  covered by tests and by hand-probing in a browser, not yet by a Solari run.
- **Feed depth is rate-sensitive.** Scrolling reached ~22 results per query on a cool
  session and ~6 on one Google had started throttling. A real run goes through Solari
  (stealth + residential proxy + captcha solving), which is exactly the mitigation, but
  `proxy.sessionDuration: 15` deliberately pins ONE egress IP per job — right for consent
  consistency, wrong for spreading load. If deep feeds prove flaky in practice that is the
  knob to turn. The `after N scrolled` log line is the signal.
- Housing adapters (`kijiji`, `craigslist`) — declared in the catalog, skipped by the
  registry with a warning. The `yelp`, `find_me_gluten_free` and `store_locator` adapters
  register but are stubs that return no findings. `yelp` and `find_me_gluten_free` will
  probably stay stubs: both sites explicitly forbid automated agents (see
  `memory/security-invariants.md`, "Third-party sources"), which is why the second real
  source is `openstreetmap`.
- **Cross-source merge is reachable but untuned.** `openstreetmap` and `google_maps` now
  both produce findings, so `mergeFindings` and the score's `corroborated` bonus finally
  have two sources — but `canonicalKey` (name + first street token) has never been measured
  against real OSM `addr:*` vs. Google's formatted address. That is item 2's leftover.
- Real auth, `user_secrets` encryption (the table exists and must stay empty in v1), extra
  requirement packs. The Leaflet map pin + radius search HAS landed
  (`apps/web/src/components/location-map.tsx`); `Location.pinned` is the flag that makes a
  deliberate pin outrank a postal code, inverting the rule that applies to geocoded
  coordinates.
