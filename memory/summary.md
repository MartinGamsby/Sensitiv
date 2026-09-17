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
  `job_events`, `places`, `place_sources`, `evidence`, `replays` (now with `adapter_id`,
  `finding_count`, `status`, `stored_path`, `size_bytes`, `content_type`, Section 2 —
  migrations `0001`+`0002`; `0003` adds the `jobs` column; `0004` adds
  `job_events.progress_json`, the run-phase marker the progress bar reads). Every new
  column is nullable and
  every reader treats `NULL` as "not recorded", never as `live`/`0`. Checked-in migrations,
  `migrate`/`seed` scripts, and the typed repositories every other package calls —
  including `listJobSummariesForUser`, the one grouped History-list query,
  `recentRunDurationsForUser` (the sample the run page's ETA is a median of), and
  `getReplayForJob`, which is scoped by replay id AND job id.
- **`apps/worker`** — long-running Node process. Loopback HTTP (`POST /jobs`,
  `GET /healthz`), an optional queued-job poll loop, the agent loop in `src/runner.ts`,
  the adapter registry, `BrowserSession` + `FixtureBrowserSession`, merge/score/dossier.
- **`apps/web`** — Next 15 App Router + Tailwind + next-intl (en/fr). API routes
  (`POST/GET /api/jobs`, `GET /api/jobs/:id`, `GET /api/jobs/:id/events` SSE,
  `GET /api/jobs/:id/replays/:replayId` — the only reader of stored replay bytes,
  `GET /api/geocode`, `PATCH /api/settings`, `GET /api/health` — booleans only, which is
  how the UI decides whether to show the BYOK field) and the form / run / history UI.
  `apps/web/src/components/ui/` is the owned-in-repo primitives layer — `Card`, `Badge`,
  `MetaRow`, `Stack`, `EmptyState`, `Button`, `Field`/`Input`/`Textarea`/`Select`,
  `Disclosure`, `SectionHeading`, `Spinner`/`LiveDot`, `icon.tsx` (hand-rolled stroke SVGs,
  all `aria-hidden`) plus `src/lib/cn.ts`. It follows the shadcn/ui *pattern* (composable,
  variant-prop components on Tailwind), not its CLI generator: no `components.json`, no
  Radix. Radix can be layered on later if a real dialog/menu/tooltip is ever needed.
  **Theming:** `globals.css` holds the token layer — CSS custom properties as
  space-separated RGB channels (`--surface`, `--fg-muted`, `--brand`, `--ring`, …) with a
  `prefers-color-scheme: dark` block; `tailwind.config.ts` maps them to alpha-aware colors
  (`bg-surface`, `text-fg-muted`, `bg-brand/25`), so most components no longer carry a
  `dark:` twin per colour. Tone families (`neutral`/`ok`/`warn`/`danger`/`info`) still alias
  Tailwind scales. Brand is teal; emerald stays reserved for "sources agree".
  **Layout contract:** the landing form is three numbered step cards with search language /
  timeout folded into an `Advanced settings` `Disclosure`; the run view puts the dossier
  *above* the activity log, which now starts collapsed ALWAYS — live or finished — because
  the progress bar in the status header carries the "is it moving" signal the open log used
  to, and stays open once a reader opens it; place cards
  show one lead excerpt per requirement with the rest behind a `Disclosure`, and replays sit
  in a collapsed `Run details` section. `Disclosure` hides with the `hidden` attribute
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
- **Scoring granularity is the next known gap.** The rubric is five rules times a
  requirement weight, which is coarse: a place either "supports" or it does not, so many
  places land on the same integer and ties fall through to review count. Deferred
  deliberately, not forgotten.
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
  register but are stubs that return no findings.
- Leaflet map pin + radius search, real auth, `user_secrets` encryption (the table exists
  and must stay empty in v1), extra requirement packs.
