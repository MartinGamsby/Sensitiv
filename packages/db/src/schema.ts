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
    requirementsJson: text("requirements_json").notNull(), // serialized PlannedRequirement[]
    intentIdsJson: text("intent_ids_json").notNull(), // serialized string[]
    searchLang: text("search_lang").notNull(),
    uiLocale: text("ui_locale").notNull(),
    timeoutSec: integer("timeout_sec").notNull(),
    errorText: text("error_text"),
    createdAt: integer("created_at").notNull(),
    startedAt: integer("started_at"),
    finishedAt: integer("finished_at"),
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
    lat: real("lat"),
    lng: real("lng"),
    canonicalKey: text("canonical_key").notNull(), // normalized name+street; unique per job
    // Written by the worker (Section 7) so the dossier reads without recomputation.
    score: real("score"),
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
