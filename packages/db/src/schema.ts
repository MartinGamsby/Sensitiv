// ===========================================================================
// Sensitiv SQLite schema (Drizzle + libsql). This package is the ONLY module in
// the repo that talks to SQLite.
//
// NO SECRETS IN ANY TABLE. Not in `jobs`, not in `job_events`, not in `replays`,
// not anywhere. `user_secrets` exists so BYOK-at-rest can be added later without
// a migration, but it stays EMPTY in v1 — never write a plaintext key into
// `ciphertext` "temporarily".
//
// SQLite type conventions:
//   uuid       -> text (crypto.randomUUID())
//   boolean    -> integer 0/1
//   timestamp  -> integer, Unix MILLISECONDS (never seconds; never mixed)
// ===========================================================================
import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  displayName: text("display_name"),
  uiLocale: text("ui_locale").notNull().default("en"),
  // null = auto (resolve from location at plan time)
  defaultSearchLang: text("default_search_lang"),
  defaultTimeoutSec: integer("default_timeout_sec").notNull().default(480),
  createdAt: integer("created_at").notNull(),
});

// EMPTY in v1. Present so BYOK-at-rest is a feature, not a migration.
export const userSecrets = sqliteTable(
  "user_secrets",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    kind: text("kind").notNull(), // 'solari' | 'anthropic'
    ciphertext: text("ciphertext").notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.kind] }),
  }),
);

export const jobs = sqliteTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    status: text("status").notNull(), // queued | running | done | partial | error
    locationJson: text("location_json").notNull(), // serialized Location
    requestText: text("request_text").notNull(),
    // What the USER asked for: the chips, derived from the catalog at enqueue.
    // Written once and never touched again, so a run always says what it was
    // asked to do independently of what the planner made of it.
    requirementsJson: text("requirements_json").notNull(), // serialized PlannedRequirement[]
    intentIdsJson: text("intent_ids_json").notNull(), // serialized string[]
    // What the PLANNER decided, written when planning finishes: the chips plus
    // whatever the free text implied, each with the weight and `kind` the run
    // actually scored against.
    //
    // These used to exist only inside each place's frozen `score_breakdown_json`,
    // which meant the read path could not see them — and the dossier's "Match
    // N%" was dividing by a ceiling built from the CHIPS alone. On a celiac +
    // "Mexican restaurant" run that ceiling was 9.5 while a place could score
    // 8.65 including +5.85 from a requirement the denominator had never heard
    // of: 91% for what is honestly a 51% match, with anything stronger silently
    // clamped at 100.
    //
    // NULL on every job planned before this column existed; readers fall back
    // to `requirements_json`, which is what those rows scored against anyway.
    plannedRequirementsJson: text("planned_requirements_json"),
    plannedIntentIdsJson: text("planned_intent_ids_json"),
    searchLang: text("search_lang").notNull(),
    uiLocale: text("ui_locale").notNull(),
    timeoutSec: integer("timeout_sec").notNull(),
    errorText: text("error_text"),
    createdAt: integer("created_at").notNull(),
    startedAt: integer("started_at"),
    finishedAt: integer("finished_at"),
    // Keyed by adapter id (+ the reserved "llm" key), serialized
    // Record<string, "fixture" | "live"> — the actual provider/browser mode
    // that ran, not an env lookup. NULL on every pre-existing row: render
    // that as "not recorded", never as "live".
    sourceModesJson: text("source_modes_json"),
    // 0/1, opt-in per run. NULL on every row written before the flag existed:
    // those runs all recorded, but a NULL means "not recorded" everywhere else
    // in this schema and readers must not invent a value for it. The worker
    // treats anything that is not 1 as "do not record".
    recordSession: integer("record_session"),
    // 0/1, search depth. 1 means "quick": read the first screen of results and
    // skip the scroll loop. NULL on every row written before the flag existed
    // — those runs all scrolled to exhaustion, and a reader must treat NULL as
    // the deep search it was, not as the new default. New rows are always
    // written 0 or 1.
    quickSearch: integer("quick_search"),
    // Where the adapters actually searched, as the Maps hop resolved it.
    // The CENTRE rather than a per-place distance, because a distance is
    // derived and throws away what it was derived from: keeping the point
    // lets the same dossier be re-measured from anywhere else later.
    searchLat: real("search_lat"),
    searchLng: real("search_lng"),
  },
  (t) => ({
    byUser: index("jobs_user_created_idx").on(t.userId, sql`${t.createdAt} desc`),
  }),
);

export const jobEvents = sqliteTable(
  "job_events",
  {
    // AUTOINCREMENT is required: id is the strictly-monotonic SSE cursor and
    // plain rowid reuse after a delete would break resumption.
    id: integer("id").primaryKey({ autoIncrement: true }),
    jobId: text("job_id")
      .notNull()
      .references(() => jobs.id),
    ts: integer("ts").notNull(), // Unix ms
    level: text("level").notNull(), // debug | info | warn | error
    message: text("message").notNull(),
    source: text("source"),
    // Serialized JobProgress — set on the few rows the worker tags as run-phase
    // markers, NULL on every other row (and on every row written before this
    // column existed). Readers treat NULL as "this row says nothing about
    // progress", never as "progress is zero".
    progressJson: text("progress_json"),
  },
  (t) => ({
    byJob: index("job_events_job_id_idx").on(t.jobId, t.id),
  }),
);

export const places = sqliteTable(
  "places",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id")
      .notNull()
      .references(() => jobs.id),
    name: text("name").notNull(),
    address: text("address"),
    category: text("category"),
    phone: text("phone"),
    url: text("url"),
    // Nullable like every column added after v1: a pre-existing row reads as
    // "no photo", never as a broken image.
    thumbnailUrl: text("thumbnail_url"),
    lat: real("lat"),
    lng: real("lng"),
    canonicalKey: text("canonical_key").notNull(), // normalized name+street; unique per job
    // Written by the worker so the dossier reads without recomputation.
    score: real("score"),
    // Serialized ScoreLine[] — the per-rule breakdown that ADDS UP to `score`,
    // stored rather than recomputed so the explanation the dossier shows is
    // the one that actually produced the ranking. NULL on every row written
    // before this column existed: readers render the score with no breakdown
    // rather than inventing lines for it.
    scoreBreakdownJson: text("score_breakdown_json"),
    conflicted: integer("conflicted"), // 0/1
  },
  (t) => ({
    byJobKey: uniqueIndex("places_job_canonical_key_idx").on(
      t.jobId,
      t.canonicalKey,
    ),
  }),
);

export const placeSources = sqliteTable(
  "place_sources",
  {
    id: text("id").primaryKey(),
    placeId: text("place_id")
      .notNull()
      .references(() => places.id),
    source: text("source").notNull(),
    sourceUrl: text("source_url").notNull(),
    rating: real("rating"),
    reviewCount: integer("review_count"),
    rawJson: text("raw_json"),
  },
  (t) => ({
    byPlace: index("place_sources_place_id_idx").on(t.placeId),
  }),
);

export const evidence = sqliteTable(
  "evidence",
  {
    id: text("id").primaryKey(),
    placeId: text("place_id")
      .notNull()
      .references(() => places.id),
    // catalog id or `custom_<slug>` — plain TEXT, NEVER an enum/union.
    requirementId: text("requirement_id").notNull(),
    claim: text("claim").notNull(),
    polarity: text("polarity").notNull(), // supports | contradicts | unclear
    quote: text("quote").notNull(), // verbatim, source language
    source: text("source").notNull(),
    sourceUrl: text("source_url").notNull(),
    date: text("date"),
    confidence: real("confidence").notNull(),
  },
  (t) => ({
    byPlace: index("evidence_place_id_idx").on(t.placeId),
  }),
);

/**
 * Extractions already paid for, so a re-run does not re-ask the model about the
 * same listing. Keyed by a hash over (source + requirement set + locales + the
 * scraped card itself) — see `extractionCacheKey` in the worker; any change to
 * what was scraped or what was being looked for is a different key, never a
 * stale hit.
 *
 * NOT scoped by `user_id`, and deliberately so: unlike every other table here,
 * a row holds no record of who searched or what they were looking for. The key
 * is a one-way hash, and `findings_json` is what a public Google Maps listing
 * said about a place. Two users researching the same restaurant get the same
 * answer; neither learns anything about the other.
 *
 * `expires_at` is NOT NULL on purpose. A cached extraction is a claim about
 * the world ("this kitchen is entirely gluten-free"), and one that outlives a
 * renovation is stale evidence presented as fresh research. There is no
 * "forever" value — see `EXTRACTION_CACHE_TTL_HOURS`.
 */
export const extractionCache = sqliteTable(
  "extraction_cache",
  {
    /** Hex sha-256 of the key material. */
    key: text("key").primaryKey(),
    /** Adapter id, for diagnostics and for a targeted purge. */
    source: text("source").notNull(),
    /** Serialized PlaceFinding[] for this one unit of scraped content. */
    findingsJson: text("findings_json").notNull(),
    createdAt: integer("created_at").notNull(),
    /** Unix ms. A row at or past this is never read and is swept. */
    expiresAt: integer("expires_at").notNull(),
  },
  (t) => ({
    byExpiry: index("extraction_cache_expires_idx").on(t.expiresAt),
  }),
);

export const replays = sqliteTable("replays", {
  id: text("id").primaryKey(),
  jobId: text("job_id")
    .notNull()
    .references(() => jobs.id),
  solariSessionId: text("solari_session_id").notNull(),
  // No longer NOT NULL: an "unavailable" replay (download failed, no safe URL
  // either) is still recorded as a row so the dossier can name the adapter and
  // finding count — it just carries no URL.
  replayUrl: text("replay_url"),
  expiresAt: integer("expires_at"),
  // All nullable — existing rows keep NULL and every reader must render that
  // as an explicit "not recorded" state, never as a working link.
  adapterId: text("adapter_id"), // which source this session was for
  findingCount: integer("finding_count"), // how many findings that source contributed
  status: text("status"), // stored | link_only | empty | unavailable | too_large
  storedPath: text("stored_path"), // repo-root-relative, e.g. data/replays/<job>/<sess>.ndjson.gz
  sizeBytes: integer("size_bytes"),
  contentType: text("content_type"), // application/gzip | application/x-ndjson
});

export const schema = {
  users,
  userSecrets,
  jobs,
  jobEvents,
  places,
  placeSources,
  evidence,
  replays,
};
