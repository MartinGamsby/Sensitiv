// The extraction cache: extractions already paid for, reused instead of
// re-asking the model about a listing it has already read.
//
// Two rules hold this together and both are enforced here rather than left to
// callers:
//
//   1. EVERY row expires. `putCachedExtractions` computes `expiresAt` from a
//      TTL it is given and refuses a non-positive one — there is no way to
//      write an immortal row. A cached extraction is a claim about the world
//      ("this kitchen is entirely gluten-free"); one that outlives a
//      renovation is stale evidence presented as fresh research.
//   2. An expired row is never READ, even before the sweep reaches it. The
//      lookup filters on `expires_at` rather than trusting that
//      `pruneExpiredExtractions` has run, so a worker that has been up for a
//      week cannot serve a row the sweep has not got to yet.
import { eq, inArray, lt } from "drizzle-orm";
import type { DbHandle } from "./client.ts";
import { extractionCache } from "./schema.ts";

/** Milliseconds in an hour, named so the arithmetic below reads. */
const HOUR_MS = 60 * 60 * 1000;

export interface CachedExtraction {
  key: string;
  /** Serialized `PlaceFinding[]`. The worker owns the shape; this module
   *  stores and returns the text and never parses it. */
  findingsJson: string;
}

/**
 * The still-live rows among `keys`, as a map. Keys with no row, or whose row
 * has expired, are simply absent — a miss and a staleness are the same thing to
 * a caller, because both mean "ask the model".
 */
export async function getCachedExtractions(
  db: DbHandle,
  keys: readonly string[],
  now: number = Date.now(),
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (keys.length === 0) return out;

  // SQLite has a bound-variable limit (999 by default); chunk rather than
  // assume a batch is small. A dining run scrapes ~30 places per query.
  for (let i = 0; i < keys.length; i += 200) {
    const slice = keys.slice(i, i + 200);
    const rows = await db
      .select({
        key: extractionCache.key,
        findingsJson: extractionCache.findingsJson,
        expiresAt: extractionCache.expiresAt,
      })
      .from(extractionCache)
      .where(inArray(extractionCache.key, slice));
    for (const row of rows) {
      // Read-time expiry check: never serve a row the sweep has not reached.
      if (row.expiresAt <= now) continue;
      out.set(row.key, row.findingsJson);
    }
  }
  return out;
}

/**
 * Store (or refresh) extractions.
 *
 * `ttlHours` must be positive — `0` means the cache is disabled and the caller
 * should not be writing at all, so it throws rather than quietly storing a row
 * that expires immediately or, worse, never.
 */
export async function putCachedExtractions(
  db: DbHandle,
  source: string,
  entries: readonly CachedExtraction[],
  ttlHours: number,
  now: number = Date.now(),
): Promise<void> {
  if (!Number.isFinite(ttlHours) || ttlHours <= 0) {
    throw new Error(
      `putCachedExtractions: ttlHours must be positive, got ${ttlHours}`,
    );
  }
  if (entries.length === 0) return;

  const expiresAt = now + ttlHours * HOUR_MS;
  for (const entry of entries) {
    await db
      .insert(extractionCache)
      .values({
        key: entry.key,
        source,
        findingsJson: entry.findingsJson,
        createdAt: now,
        expiresAt,
      })
      // Re-extracting the same content is the cheapest possible way to learn
      // it is still current, so a repeat write pushes the expiry out rather
      // than being dropped.
      .onConflictDoUpdate({
        target: extractionCache.key,
        set: { findingsJson: entry.findingsJson, expiresAt },
      });
  }
}

/** Delete every expired row. Returns how many went. */
export async function pruneExpiredExtractions(
  db: DbHandle,
  now: number = Date.now(),
): Promise<number> {
  const doomed = await db
    .select({ key: extractionCache.key })
    .from(extractionCache)
    .where(lt(extractionCache.expiresAt, now));
  if (doomed.length === 0) return 0;
  await db.delete(extractionCache).where(lt(extractionCache.expiresAt, now));
  return doomed.length;
}

/** Drop every row for one source. The escape hatch for "that adapter's
 *  extractions are wrong and I do not want to wait out the TTL". */
export async function clearCachedExtractions(
  db: DbHandle,
  source: string,
): Promise<void> {
  await db.delete(extractionCache).where(eq(extractionCache.source, source));
}
