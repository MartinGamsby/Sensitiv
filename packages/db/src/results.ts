import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import {
  DossierReplaySchema,
  DossierSchema,
  EvidenceSchema,
  PlaceDetailSchema,
  PlaceSourceSchema,
  disclaimerFor,
  type Dossier,
  type DossierPlace,
  type DossierReplay,
  type Evidence,
  type PlaceDetail,
  type PlaceSource,
} from "@sensitiv/shared";
import type { DbHandle } from "./client.ts";
import { getJob } from "./jobs.ts";
import {
  evidence as evidenceTable,
  placeSources,
  places,
  replays,
} from "./schema.ts";

/** Insert or merge a place on `(job_id, canonical_key)`. Score/conflicted are left untouched. */
export async function upsertPlace(
  db: DbHandle,
  jobId: string,
  place: PlaceDetail,
): Promise<{ id: string }> {
  const parsed = PlaceDetailSchema.parse(place);
  const values = {
    id: randomUUID(),
    jobId,
    name: parsed.name,
    address: parsed.address ?? null,
    category: parsed.category ?? null,
    phone: parsed.phone ?? null,
    url: parsed.url ?? null,
    lat: parsed.lat ?? null,
    lng: parsed.lng ?? null,
    canonicalKey: parsed.canonicalKey,
  };

  const rows = await db
    .insert(places)
    .values(values)
    .onConflictDoUpdate({
      target: [places.jobId, places.canonicalKey],
      set: {
        name: values.name,
        address: values.address,
        category: values.category,
        phone: values.phone,
        url: values.url,
        lat: values.lat,
        lng: values.lng,
      },
    })
    .returning({ id: places.id });

  const row = rows[0];
  if (!row) throw new Error("upsertPlace: upsert returned no row");
  return { id: row.id };
}

/** Worker-written ranking so the dossier reads without recomputation (Section 7). */
export async function setPlaceScore(
  db: DbHandle,
  placeId: string,
  score: number,
  conflicted: boolean,
): Promise<void> {
  await db
    .update(places)
    .set({ score, conflicted: conflicted ? 1 : 0 })
    .where(eq(places.id, placeId));
}

export async function addPlaceSource(
  db: DbHandle,
  placeId: string,
  source: PlaceSource,
  rawJson?: unknown,
): Promise<{ id: string }> {
  const parsed = PlaceSourceSchema.parse(source);
  const id = randomUUID();
  await db.insert(placeSources).values({
    id,
    placeId,
    source: parsed.source,
    sourceUrl: parsed.sourceUrl,
    rating: parsed.rating ?? null,
    reviewCount: parsed.reviewCount ?? null,
    rawJson: rawJson === undefined ? null : JSON.stringify(rawJson),
  });
  return { id };
}

export async function addEvidence(
  db: DbHandle,
  placeId: string,
  input: Evidence,
): Promise<{ id: string }> {
  const parsed = EvidenceSchema.parse(input);
  const id = randomUUID();
  await db.insert(evidenceTable).values({
    id,
    placeId,
    requirementId: parsed.requirementId,
    claim: parsed.claim,
    polarity: parsed.polarity,
    quote: parsed.quote,
    source: parsed.source,
    sourceUrl: parsed.sourceUrl,
    date: parsed.date ?? null,
    confidence: parsed.confidence,
  });
  return { id };
}

export interface ReplayInput {
  solariSessionId: string;
  /** Absent for an "unavailable" replay — no safe URL survived either. */
  replayUrl?: string;
  expiresAt?: number;
  adapterId?: string;
  findingCount?: number;
  status?: "stored" | "link_only" | "empty" | "unavailable" | "too_large";
  storedPath?: string;
  sizeBytes?: number;
  contentType?: string;
}

export async function addReplay(
  db: DbHandle,
  jobId: string,
  input: ReplayInput,
): Promise<{ id: string }> {
  const id = randomUUID();
  await db.insert(replays).values({
    id,
    jobId,
    solariSessionId: input.solariSessionId,
    replayUrl: input.replayUrl ?? null,
    expiresAt: input.expiresAt ?? null,
    adapterId: input.adapterId ?? null,
    findingCount: input.findingCount ?? null,
    status: input.status ?? null,
    storedPath: input.storedPath ?? null,
    sizeBytes: input.sizeBytes ?? null,
    contentType: input.contentType ?? null,
  });
  return { id };
}

/**
 * Look a replay up by id AND job id — never trust a bare replay id from a
 * request. Returns `undefined` when the replay does not exist or belongs to
 * a different job (the download route folds that into the same 404 as
 * "not yours" for the job itself).
 */
export async function getReplayForJob(
  db: DbHandle,
  jobId: string,
  replayId: string,
): Promise<typeof replays.$inferSelect | undefined> {
  const rows = await db
    .select()
    .from(replays)
    .where(and(eq(replays.id, replayId), eq(replays.jobId, jobId)));
  return rows[0];
}

function toPlaceDetail(row: typeof places.$inferSelect): PlaceDetail {
  return PlaceDetailSchema.parse({
    name: row.name,
    address: row.address ?? undefined,
    lat: row.lat ?? undefined,
    lng: row.lng ?? undefined,
    category: row.category ?? undefined,
    phone: row.phone ?? undefined,
    url: row.url ?? undefined,
    canonicalKey: row.canonicalKey,
  });
}

function toPlaceSource(row: typeof placeSources.$inferSelect): PlaceSource {
  return PlaceSourceSchema.parse({
    source: row.source,
    sourceUrl: row.sourceUrl,
    rating: row.rating ?? undefined,
    reviewCount: row.reviewCount ?? undefined,
  });
}

function toEvidence(row: typeof evidenceTable.$inferSelect): Evidence {
  return EvidenceSchema.parse({
    requirementId: row.requirementId,
    claim: row.claim,
    polarity: row.polarity,
    quote: row.quote,
    source: row.source,
    sourceUrl: row.sourceUrl,
    date: row.date ?? undefined,
    confidence: row.confidence,
  });
}

/**
 * Assemble the dossier: join places + sources + evidence + replays for a job the
 * caller owns. Computes NOTHING — scoring lives in the worker (Section 7); this
 * returns the stored `score`/`conflicted`. Returns `undefined` when the job does
 * not exist or belongs to another user.
 */
export async function getDossier(
  db: DbHandle,
  jobId: string,
  userId: string,
): Promise<Dossier | undefined> {
  const job = await getJob(db, jobId, userId);
  if (!job) return undefined;

  const placeRows = await db
    .select()
    .from(places)
    .where(eq(places.jobId, jobId))
    .orderBy(desc(places.score), places.canonicalKey);

  const dossierPlaces: DossierPlace[] = [];
  for (const placeRow of placeRows) {
    const sourceRows = await db
      .select()
      .from(placeSources)
      .where(eq(placeSources.placeId, placeRow.id));
    const evidenceRows = await db
      .select()
      .from(evidenceTable)
      .where(eq(evidenceTable.placeId, placeRow.id));

    dossierPlaces.push({
      place: toPlaceDetail(placeRow),
      sources: sourceRows.map(toPlaceSource),
      evidence: evidenceRows.map(toEvidence),
      score: placeRow.score ?? 0,
      conflicted: placeRow.conflicted === 1,
    });
  }

  const replayRows = await db
    .select()
    .from(replays)
    .where(eq(replays.jobId, jobId));

  return DossierSchema.parse({
    jobId: job.id,
    status: job.status,
    uiLocale: job.uiLocale,
    searchLang: job.searchLang,
    places: dossierPlaces,
    replays: replayRows.map(toDossierReplay),
    disclaimer: disclaimerFor(job.uiLocale),
  });
}

/** A `NULL` status (every pre-existing row, before this change) maps to
 *  `"unavailable"` — never rendered as a live link. `storedPath` is
 *  deliberately NOT exposed here: the download route resolves it
 *  server-side from the row id, so the dossier never carries a filesystem
 *  path to the client. */
function toDossierReplay(row: typeof replays.$inferSelect): DossierReplay {
  return DossierReplaySchema.parse({
    id: row.id,
    adapterId: row.adapterId ?? undefined,
    status: row.status ?? "unavailable",
    findingCount: row.findingCount ?? undefined,
    sizeBytes: row.sizeBytes ?? undefined,
    url: row.replayUrl || undefined,
    expiresAt: row.expiresAt ?? undefined,
  });
}
