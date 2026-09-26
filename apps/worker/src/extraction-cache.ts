// Deciding what an extraction may be reused for.
//
// The database module stores and expires rows; this module answers the harder
// question — WHEN two extractions are the same question, such that one may
// stand in for the other. Getting that wrong in an app about whether a kitchen
// is safe would be worse than never caching at all, so the key is built to make
// a wrong hit impossible rather than to make hits likely:
//
//   * the scraped content itself is in the key, canonicalised. A listing whose
//     text changed by one character is a different key.
//   * the REQUIREMENTS are in the key. The same card extracted for "celiac"
//     and for "celiac + wheelchair access" are different questions with
//     different answers, and the second must never be served the first.
//   * the locales are in the key. `claim` is written in the UI locale and the
//     quote is left in the search language.
//   * the source is in the key. Two adapters reading the same place are not
//     interchangeable.
//
// What is NOT in the key: the job, the user, the query that found the place,
// and the search URL. None of them change what the model would answer, and
// including them would make the cache per-run — which is to say, useless.
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  getCachedExtractions,
  putCachedExtractions,
  type DbHandle,
} from "@sensitiv/db";
import {
  EvidenceSchema,
  PlaceDetailSchema,
  PlaceSourceSchema,
  type PlannedRequirement,
  type SearchLanguage,
  type UiLocale,
} from "@sensitiv/shared";
import type { PlaceFinding } from "./adapters/types.ts";

/**
 * A stable string for any JSON-ish value: object keys sorted at every level, so
 * two scrapes that differ only in property order hash the same.
 *
 * `JSON.stringify` alone would not do — V8's property order follows insertion,
 * and a blob assembled by a page script has no guaranteed order.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

/**
 * What the run was looking for, reduced to the parts that change an answer.
 *
 * `id`, `label`, `must` and `satisfiedBy` all reach the extraction prompt
 * verbatim. `weight` does not — it is applied later by `scorePlace` — so it is
 * deliberately excluded: re-weighting a requirement must not throw away a
 * perfectly good extraction.
 */
export function requirementsFingerprint(
  requirements: readonly PlannedRequirement[],
): string {
  return canonicalJson(
    [...requirements]
      .map((r) => ({
        id: r.id,
        label: r.label,
        must: r.must,
        satisfiedBy: r.satisfiedBy,
      }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  );
}

export interface ExtractionKeyArgs {
  source: string;
  requirements: readonly PlannedRequirement[];
  uiLocale: UiLocale;
  searchLang: SearchLanguage;
}

/**
 * The cache key for one unit of scraped content.
 *
 * Hashed rather than stored plainly, for two reasons that both matter: the key
 * is a primary key and the content can be 20 KB, and the row then holds no
 * readable record of what anyone searched for (see the table's comment in
 * `packages/db/src/schema.ts`).
 *
 * Fields are joined with a delimiter that cannot occur in any of them — each
 * part is a JSON string or a hex digest — so no combination of values can be
 * made to collide by shifting a boundary.
 */
export function extractionCacheKey(unit: unknown, args: ExtractionKeyArgs): string {
  const material = canonicalJson({
    // Bump when what a stored answer may contain changes. v2: model-returned
    // URLs are no longer kept, so a v1 row can still carry one.
    v: 2,
    source: args.source,
    uiLocale: args.uiLocale,
    searchLang: args.searchLang.code,
    requirements: requirementsFingerprint(args.requirements),
    unit: canonicalJson(unit),
  });
  return createHash("sha256").update(material).digest("hex");
}

/**
 * The seam `extractFindings` talks to.
 *
 * An interface rather than a direct `@sensitiv/db` import so the extractor
 * stays pure and testable, the same shape as `AdapterContext.fetch` and
 * `RunJobDeps`. A run with the cache disabled simply passes nothing.
 */
export interface ExtractionCache {
  get(keys: readonly string[]): Promise<Map<string, PlaceFinding[]>>;
  put(entries: ReadonlyArray<{ key: string; findings: PlaceFinding[] }>): Promise<void>;
}

/**
 * The SQLite-backed cache, or `undefined` when `ttlHours` is `0`.
 *
 * Returning `undefined` rather than a no-op object is deliberate: "the cache
 * is off" then travels as an absent `AdapterContext.extractionCache`, which
 * `extractFindings` already reads as "do not even compute keys", instead of as
 * an object that silently answers nothing.
 */
export function createExtractionCache(args: {
  db: DbHandle;
  ttlHours: number;
  source: string;
}): ExtractionCache | undefined {
  if (!Number.isFinite(args.ttlHours) || args.ttlHours <= 0) return undefined;

  return {
    async get(keys) {
      const rows = await getCachedExtractions(args.db, keys);
      const out = new Map<string, PlaceFinding[]>();
      for (const [key, json] of rows) {
        // A row that no longer parses against the current schema is a MISS,
        // not a crash: the shape of a finding can change between versions and
        // the honest response to "I can no longer read this" is to ask again.
        const parsed = CachedFindingsSchema.safeParse(safeJsonParse(json));
        if (parsed.success) out.set(key, parsed.data);
      }
      return out;
    },
    async put(entries) {
      await putCachedExtractions(
        args.db,
        args.source,
        entries.map((e) => ({ key: e.key, findingsJson: JSON.stringify(e.findings) })),
        args.ttlHours,
      );
    },
  };
}

/** Validated on the way OUT of the cache, not just on the way in. Stored JSON
 *  is data this process wrote, but it is still data crossing a version
 *  boundary, and everything else in this repo re-validates at that boundary. */
const CachedFindingsSchema = z.array(
  z.object({
    place: PlaceDetailSchema,
    source: PlaceSourceSchema,
    evidence: z.array(EvidenceSchema),
  }),
);

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}
