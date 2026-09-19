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
  TWO adapters, and both are real: `google_maps` (browser, LLM extraction) and
  `openstreetmap` (Overpass API, `needsBrowser: false`, deterministic tag->evidence with
  no LLM call — the only source that returns real results from an empty `.env`). There is
  no third kind any more: `yelp`, `find_me_gluten_free` and `store_locator` were
  registered no-ops that logged a line, returned nothing, and made the dossier report that
  they had "run but contributed nothing". Deleted. An id the catalog declares but this
  build does not implement now hits the registry's log-and-skip path, which is the only
  degradation left. `src/http.ts` is the
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
  timeout folded into an `Advanced settings` `Disclosure`.

  In step 1, the two ways of NARROWING a location are mutually exclusive and deliberately
  unequal: one `panel` state, not two booleans. The map is the only input on the form with
  no inference in it (the forward geocode answers "Quebec, Canada" with a province
  centroid, a postal code covers a delivery area, a desktop's own location is its IP), so
  it gets a real bordered button and the postal code gets a quiet link beside it. A pin
  outranks a postal code downstream and typing one already clears the other, so offering
  both at once invited filling in two things where only one counts. A collapsed postal
  trigger still states its value — a panel that hides a filled field is a form that lies
  about what it will submit.

  **A run page states the QUESTION above the answer** (`RunBrief`, fed from the `jobs`
  row by the server pass in `jobs/[id]/page.tsx`, not from the dossier — it has to render
  while a run is still going). Headline = `requestText`, falling back to the location for
  a chips-only run; then the requirement badges, the location, the radius, the dropped
  pin or the resolved `searchCenter` ("around where?"), the search language BY NAME, and
  when it ran. Before this, `/jobs/<uuid>` said "Research run" over a list of restaurants
  and nothing else — useless to anyone the link was sent to, and to the person who ran it
  a week later. The same facts ride into the place-detail overlay as a one-line
  `RunBriefLine`, because `?place=` is the URL most likely to reach someone who never saw
  the dossier, and into the History list as badges (`GET /api/jobs` now returns
  `requirements` as ids + labels). Requirement labels resolve through the catalog first,
  so they follow the READER's locale rather than the one the run was created in.

  **The status header folds itself away** (`RunStatus`). A run already finished when the
  server rendered renders collapsed with no animation — `initialStatus` from the page's
  server pass is what tells that apart from a run finishing while you watch, which stays
  open `AUTO_COLLAPSE_MS` and then folds. Collapsed it keeps the status word and the
  duration. `done` ONLY self-collapses: a `partial` or `error` card holds the only
  explanation of why the dossier looks the way it does. Touching the control settles it
  for the page load, so the timer can never undo what the reader just did.

  **The search radius is a number, not a menu, and it renders as one LINE** — label,
  slider, number box, unit. `RadiusField` is bounded by `MIN_RADIUS_KM` 0.5 to
  `MAX_RADIUS_KM` 100 (step 0.5); the slider maps its travel to km on a SQUARE curve,
  because linear over that range would squeeze the useful 1–10 km into the first
  centimetre. The four old options are gone: the slider is the coarse gesture and the
  box the exact one, and preset chips turned the control back into a block. It holds its
  text in local state and commits only a valid in-range
  parse, because a controlled numeric input that commits every keystroke cannot be cleared
  or retyped — "10" only reaches "2" through "", which parses as 0 and the schema rejects.
  Blur settles whatever is left: clamp if out of range, restore the last good value if
  unparseable. `DEFAULT_RADIUS_KM` is **3**, not 5 — a 5 km circle over a city centre is
  most of the city. Those three constants live in `packages/shared/src/schema/location.ts`
  beside the schema; the schema's own `max(500)` stays where it is because `LocationSchema`
  is on the READ path (`rowToJob` parses every stored job through it) and narrowing a
  read-path bound can only reject rows that already exist.

  **The dossier has two views, and the URL says which** (`?view=map`, default `list`,
  never written when it is the default). `list` is the auto-fit card grid; `map` is a
  Leaflet map beside a single column of the same cards (`lg:grid-cols-[1fr_23rem]`, map
  sticky). `DossierMap` draws the run's `searchCenter` as a hollow ring — it is where the
  run looked FROM, not a 17th result — the radius as a circle, and one numbered teardrop
  per place, renumbered live by whatever the sort control says so the map and the list
  never disagree about which place is "3". Podium pins mirror the medal's hues; the rank
  is IN the pin, so colour is never the only carrier. Places with no coordinates are
  COUNTED in a note under the map rather than silently dropped.

  Switching view is a `replace` (Back should leave the dossier, not step through
  glances at the map); clicking a pin is a `push`, because the overlay closes with
  `router.back()` and replacing made Escape skip past the dossier entirely.

  Leaflet's own chrome is themed through the token layer in `globals.css`, and dark mode
  inverts + hue-rotates the TILE pane only (`--map-tile-filter`) — raster tiles have no
  dark edition, and marker/overlay panes must not be inverted with them.

  **One width for the whole run.** The `xl:-mx-16` breakout lives on `RunView`'s root,
  not on the dossier — widening only the results left the title and status header
  stepping in from them on a wide screen.

  The run view puts the dossier
  *above* the activity log, which now starts collapsed ALWAYS — live or finished — because
  the progress bar in the status header carries the "is it moving" signal the open log used
  to, and stays open once a reader opens it.

  **The dossier is a grid, and a place detail is a URL.** The cards sit in
  `repeat(auto-fit, minmax(min(100%, 20rem), 1fr))` — one column on a phone, two on a
  laptop, three from `xl`, where the whole dossier section also breaks out of the reading
  column (`xl:-mx-16`) because results are a scanning surface, not prose. The `min(100%,
  …)` is what makes it collapse instead of overflowing below 20rem. Cards are `h-full` so
  a row is uniform.

  **A place card is a shortlist entry:** a rank medal straddling the top edge, then a
  column holding the photo with the match pill UNDER it, then name / address / category /
  conflict badge, then a bare chevron centred on the right edge.

  The medal (`ui/rank-medal.tsx`) is half in the card and half in the gutter, centred,
  which is what makes rank register before the match percentage — it is a property of the
  card's POSITION, not another field of the place. Top three get a drawn laurel (inline
  SVG, one branch mirrored) and gold/silver/bronze. The wreath's geometry is DERIVED,
  not hand-placed: stem, leaf attachment points and leaf angles all come off one circle
  (`CX`/`CY`/`STEM_R` in `rank-medal.tsx`), and a leaf is a pointed almond rather than an
  ellipse. The first version hand-placed ellipses on a hand-drawn curve and read as beads
  on a string — blunt blobs sitting ON the stem instead of leaves growing out of it.
  Below the podium, 4th down is a plain chip, because the
  gap between 4th and 5th is a rounding error in a heuristic score. The number is always
  inside the medal, so colour is never the only carrier, and the whole thing is
  `aria-hidden` since the DOM order already says it. It lives OUTSIDE the card's link so
  it cannot be read as part of the place's name. Consequences: the card is `relative` and
  must NOT be `overflow-hidden` (the link carries its own `rounded-xl` for the hover
  fill), and the grid needs `gap-y-8` + `pt-7` for the ~21px the medal hangs over the
  edge. The medal sits 3px above dead-centre on that edge, and the row gap is NOT
  widened to match — the 3px comes out of the clearance, not out of card spacing. The score sits with the photo because both answer
  "is this worth opening" at a glance, and because the right-hand rail it used to live in
  cost the title ~90px — the difference between a two-line and a four-line name in a
  narrow column. The word "Details" beside the chevron is gone: it was a second thing to
  read on a card whose whole job is to be skimmed.

  That is also why there is no longer a container query on the card. There WAS one
  (`.place-card`, `@container (max-width: 26rem)`) to stack the right-hand rail
  underneath in a narrow column; the rail is gone, so the layout holds down to 360px on
  its own.

  The whole card is a link to `?place=<canonicalKey>`, which opens
  `PlaceDetailOverlay`: score breakdown, source chips, per-requirement excerpts (one
  lead, the rest behind a nested `Disclosure`), red flags, website, disclaimer.

  That detail used to be an in-card disclosure, and the URL is why it is not any more —
  an expanded card had no address, so "look at this one" was not something a reader could
  send anyone, and a card that grew in place dragged its whole grid row with it. It is a
  QUERY PARAMETER rather than a `/places/<key>` child route on purpose: the overlay has
  to leave the dossier mounted (scroll position, sort choice, no refetch), which needs
  Next's intercepting routes, and `(.)places/[key]` under `[locale]` crashes the App
  Router client with `initialTree is not iterable` on 15.1.3 — the server renders the
  intercepted route and answers 200, then `navigate-reducer` throws. Verified in the
  browser; the route files were written, reproduced the crash, and were deleted. Staying
  on one route also means opening a place costs no request, since the dossier is already
  in memory.

  Replays sit in a collapsed `Run details` section. Every card renders a photo-sized element whether or not a photo
  exists — `PlacePhoto` falls back to an initials tile hued from the name — because a
  missing image element made titles start at different x positions down the list.
  A finished run can be deleted from History behind an inline two-step confirmation
  (`DELETE /api/jobs/:id`); the extraction cache deliberately survives, and the panel says
  so. A queued or running job is refused with 409 rather than pulled out from under the
  worker. `Disclosure` hides with the `hidden` attribute
  rather than unmounting — collapsed content stays in the DOM (so `querySelector` assertions
  and in-page search still find it) while correctly leaving the accessibility tree.
  The disclaimer is deliberately rendered outside every collapsible section.
- **Where a chip searches is asked, not inferred.** Step 2 renders a "Look for this in:"
  row under the chip grid for any requirement declaring more than one intent (celiac →
  Dining / Grocery, mold → Housing / Local services), starting on the first and never
  letting the last one off. It travels as `chipIntents` on `POST /api/jobs`, lands in each
  stored `PlannedRequirement.intentIds`, and the worker feeds it back into `plan()` — so
  no migration was needed. The planner may pick among those intents and may not add one.
  This replaced an inference path that could not work: `mergeLlmRequirement` only narrowed
  a chip's intents when the model RE-LISTED it, and the planner prompt forbids re-listing
  chips, so `celiac` always meant dining AND grocery and a run for a Mexican restaurant
  spent half its budget on "gluten free grocery store".
- **The subject of a search outranks a preference.** The planner tags each free-text
  requirement `kind: "subject" | "preference"`; a subject is the kind of place ("Mexican
  restaurant"), carries `SUBJECT_REQUIREMENT_WEIGHT` (3, a chip's weight) instead of 1, and
  an `unverified` line on it costs `-0.5 x weight` rather than 0. Before this, a gluten-free
  pastry shop beat an actual gluten-free Mexican restaurant on a "Mexican restaurant"
  search: perfect celiac evidence, `unverified` on Mexican, and being the wrong kind of
  place entirely was free. The base system prompt now also requires quotes to be SHORT and
  CONTIGUOUS — the extractor was stitching a card's category, address and description into
  one quote, which `quoteAppearsIn` then discarded along with the true claim it supported.

- **Each requirement's own contribution is on the shortlist card.** `requirementMarks`
  (`apps/web/src/lib/requirement-marks.ts`) folds the stored breakdown into one pill per
  requirement — chips first, then heaviest, then strongest — rendered by `RequirementMarks`
  in `dossier-place-card.tsx`. Green supported, amber conflicted, red contradicted, and a
  neutral `?` for a requirement no source settled, which is never green. The single
  percentage answered "how good is this place"; the pills answer "is this one safe for me",
  which is the question someone opens Sensitiv with, and they make a column of cards
  scannable for one requirement regardless of how the run ranked them.

- **A score is derived, never stored.** `scorePlace` lives in `packages/shared/src/score.ts`
  and runs twice: in the worker, to rank and cap a run in flight, and again in
  `getDossier` / `listJobSummariesForUser`, over the stored evidence, every time anyone
  reads a dossier. Change a weight and every dossier ever run re-ranks. `places.score` is
  still written — the SQL `ORDER BY` needs it and the worker needs a ranking mid-run — but
  nothing on the read path trusts it, and `results.test.ts` stores deliberately wrong
  numbers to prove it.
  This replaced a frozen score + breakdown per row, which hid a real bug: the planner's
  requirements were persisted NOWHERE, so the dossier divided by a ceiling built from the
  chips alone and showed a 51% match as 91%. `effectiveRequirements` rebuilds a
  pre-`planned_requirements_json` run's list from its stored breakdown (the only record
  those runs kept) and refreshes any catalog chip's weight from the catalog, so an old
  dossier scores against today's rubric too.

- **A place's own category is evidence.** Every adapter records one — Google Maps writes
  "Mexican restaurant", OpenStreetMap writes its `cuisine` tag ("mexican",
  "arepa;venezuelan", "chocolate;crepe;dessert") — and nothing read it, so an OSM place
  scored ZERO on "Mexican restaurant" however plainly its category said otherwise (the OSM
  adapter only emits evidence for catalog requirements it holds a tag map for). `scorePlace`
  now grades `place.category` against a subject's `categoryHints`, folding a `strong` match
  in as a support at `CATEGORY_MATCH_CONFIDENCE` (0.75 — below a quoted claim, so the two
  never tie) and adding `related` / `mismatched` rules for the grades between confirmed and
  contradicted. `unverified` became a true fallthrough: it fires only when nothing else did.
  `effectiveRequirements` recovers a legacy run's `kind` from its recorded weight
  (`makeCustomRequirement` writes only 1 or `SUBJECT_REQUIREMENT_WEIGHT`), so old dossiers
  get the strong match too — but not `related`/`excluded`, which need stored hints.

- **Provenance is part of the score.** `SOURCE_RELIABILITY` discounts supporting claims by
  source (OpenStreetMap 0.7, Google Maps 1), contradictions are never discounted, and
  corroboration scales with summed reliability rather than row count. See
  `memory/catalog-contract.md` for the rules and why each asymmetry is there. The dossier
  states the discount on the line it affected.

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
- **Unbuilt vs. refused is now a real distinction in the catalog.** `store_locator`
  (grocery) and `kijiji` / `craigslist` (housing) are `PLANNED_ADAPTER_IDS`: declared in
  an intent, unregistered in the worker, skipped by the registry with a warning, reported
  nowhere in the UI. `yelp` and `find_me_gluten_free` are `REFUSED_ADAPTER_IDS` — both
  sites explicitly forbid automated agents (see `memory/security-invariants.md`,
  "Third-party sources") — so they appear in NO intent, and the catalog integrity test
  asserts that. All three used to be registered no-op adapters; that is what produced the
  dossier's "they ran but contributed nothing" line, which is also gone.
- **Cross-source merge is reachable but untuned.** `openstreetmap` and `google_maps` now
  both produce findings, so `mergeFindings` and the score's `corroborated` bonus finally
  have two sources — but `canonicalKey` (name + first street token) has never been measured
  against real OSM `addr:*` vs. Google's formatted address. That is item 2's leftover.
- Real auth, `user_secrets` encryption (the table exists and must stay empty in v1), extra
  requirement packs. The Leaflet map pin + radius search HAS landed
  (`apps/web/src/components/location-map.tsx`); `Location.pinned` is the flag that makes a
  deliberate pin outrank a postal code, inverting the rule that applies to geocoded
  coordinates.
