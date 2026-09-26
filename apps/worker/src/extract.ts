// The extraction contract: an adapter pulls a tight JSON blob off the page; the
// LLM maps that blob to places + evidence; Zod validates; every quote is checked
// to be a verbatim substring of the blob before it is kept; on failure we retry
// once then SKIP the page (never fail the job).
import { z } from "zod";
import {
  EvidencePolaritySchema,
  EvidenceSchema,
  PlaceDetailSchema,
  type Evidence,
  type PlannedRequirement,
  type SearchLanguage,
  type UiLocale,
} from "@sensitiv/shared";
import { baseSystemPrompt, fenceUntrusted } from "@sensitiv/shared/prompts";
import type { LlmProvider } from "@sensitiv/shared/llm";
import { canonicalKey, normalizeText } from "./merge.ts";
import { extractionCacheKey, type ExtractionCache } from "./extraction-cache.ts";
import type { PlaceFinding } from "./adapters/types.ts";
import type { JobLogLevel } from "./logger.ts";
import { describeError, isAbortError } from "./util.ts";

// No `.default()` / `.transform()` here: keeping input === output means the LLM
// seam infers a single clean type. Missing optionals are normalised below.
export const ExtractedEvidenceSchema = z.object({
  requirementId: z.string().min(1),
  claim: z.string().min(1),
  polarity: EvidencePolaritySchema,
  quote: z.string().optional(),
  confidence: z.number().optional(),
  date: z.string().optional(),
});

export const ExtractedPlaceSchema = z.object({
  name: z.string().min(1),
  address: z.string().optional(),
  category: z.string().optional(),
  phone: z.string().optional(),
  url: z.string().optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  rating: z.number().optional(),
  reviewCount: z.number().int().nonnegative().optional(),
  evidence: z.array(ExtractedEvidenceSchema).optional(),
});

export const ExtractionSchema = z.object({
  places: z.array(ExtractedPlaceSchema),
});
export type Extraction = z.infer<typeof ExtractionSchema>;

type Log = (level: JobLogLevel, message: string) => Promise<void>;

export interface BuildFindingsArgs {
  source: string;
  sourceUrl: string;
  /**
   * The blob the extraction was produced from — the OBJECT, not its JSON
   * encoding. See `quoteAppearsIn` for why that distinction is the whole bug.
   */
  blob: unknown;
  log: Log;
  /**
   * Whether `place.url` in the extraction may be kept. True for a recorded
   * fixture, whose URLs are part of the recording. False on the live LLM path
   * (`extractFindings`): the adapters show the model no link to copy, so any
   * URL it returns is one it made up, and it would otherwise be stored as the
   * place's link and cited as the source of every claim.
   */
  keepUrls?: boolean;
}

/**
 * Collect every string leaf of a scraped blob.
 *
 * This, not `JSON.stringify(blob)`, is what the model actually read as CONTENT.
 * The two differ in ways that made an honest quote unverifiable:
 *
 *   - a newline inside `card.innerText` is a real newline in the leaf but the
 *     two characters backslash + n in the stringified form. The model replies
 *     in JSON, so `JSON.parse` turns its escape back into a real newline before
 *     the guard sees it — meaning ANY quote spanning a line break failed, always.
 *     Google Maps result cards are multi-line by construction, so this was not
 *     an edge case;
 *   - a `"` in the source is `\"` in the stringified form, so any quote
 *     containing one failed too.
 *
 * Both dropped good evidence and blamed the model for it. The observed case was
 * a bakery called "Parc Sans Gluten" losing its only celiac support — the exact
 * failure the scoring rubric was rewritten to prevent, re-entering here.
 */
function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const item of value) collectStrings(item, out);
  else if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectStrings(item, out);
  }
  return out;
}

/**
 * Fold away differences that carry no meaning, so the guard tests whether the
 * model REPRODUCED the source rather than whether it reproduced our encoding
 * of it.
 *
 * What is folded, and why each one is safe: full-width `＜`/`＞` (`fenceUntrusted`
 * rewrites runs of `<<`/`>>` before the model ever sees them, so the model
 * faithfully quotes a character that is not in the source); curly quotes,
 * apostrophes and dashes (models routinely "tidy" these); whitespace runs
 * (a line break becomes a space); and case.
 *
 * What is NOT folded: the words themselves, or their order. Reproducing those
 * is what the guard actually checks, and it is untouched — a model cannot
 * invent a claim and have it pass.
 */
export function normalizeForQuoteMatch(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[＜]/g, "<")
    .replace(/[＞]/g, ">")
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”‟″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Is `quote` really present in the scraped content?
 *
 * The anti-fabrication guard. Each leaf is matched SEPARATELY rather than
 * against one concatenated haystack, so a quote cannot be stitched together out
 * of the tail of one field and the head of an unrelated one.
 */
export function quoteAppearsIn(quote: string, blob: unknown): boolean {
  const needle = normalizeForQuoteMatch(quote);
  if (needle === "") return true;
  return collectStrings(blob).some((leaf) =>
    normalizeForQuoteMatch(leaf).includes(needle),
  );
}

/** Quotes are rendered as one line in the dossier; a scraped card's line breaks
 *  are layout, not content. Collapse them for display, keeping the model's own
 *  casing and accents (only the MATCHING above is case-folded). */
function tidyQuote(quote: string): string {
  return quote.replace(/\s+/g, " ").trim();
}

/**
 * Turn a validated `Extraction` into `PlaceFinding[]`. Drops any evidence whose
 * quote does not actually appear in the blob (fabricated quote guard) — see
 * `quoteAppearsIn`, which compares the source STRINGS rather than their JSON
 * encoding.
 */
export async function buildFindingsFromExtraction(
  extraction: Extraction,
  args: BuildFindingsArgs,
): Promise<PlaceFinding[]> {
  const findings: PlaceFinding[] = [];

  for (const raw of extraction.places) {
    const url = args.keepUrls === false ? undefined : raw.url;
    const place = PlaceDetailSchema.parse({
      name: raw.name,
      address: raw.address,
      category: raw.category,
      phone: raw.phone,
      url,
      lat: raw.lat,
      lng: raw.lng,
      canonicalKey: canonicalKey(raw.name, raw.address),
    });
    const sourceUrl = url ?? args.sourceUrl;

    const evidence: Evidence[] = [];
    for (const ev of raw.evidence ?? []) {
      const quote = tidyQuote(ev.quote ?? "");
      if (quote !== "" && !quoteAppearsIn(quote, args.blob)) {
        // Say WHAT was dropped. Without the text this line could not be acted
        // on: "the model made something up" and "the guard cannot match its own
        // encoding" look identical, and for a long time it was the second.
        await args.log(
          "debug",
          `dropped an unverifiable quote for "${raw.name}" (${ev.requirementId}): ` +
            JSON.stringify(quote.slice(0, 160)),
        );
        continue;
      }
      evidence.push(
        EvidenceSchema.parse({
          requirementId: ev.requirementId,
          claim: ev.claim,
          polarity: ev.polarity,
          quote,
          source: args.source,
          sourceUrl,
          date: ev.date,
          confidence: ev.confidence ?? 0.5,
        }),
      );
    }

    findings.push({
      place,
      source: {
        source: args.source,
        sourceUrl,
        rating: raw.rating,
        reviewCount: raw.reviewCount,
      },
      evidence,
    });
  }

  return findings;
}

export interface ExtractFindingsArgs {
  source: string;
  sourceUrl: string;
  requirements: readonly PlannedRequirement[];
  uiLocale: UiLocale;
  searchLang: SearchLanguage;
  llm: LlmProvider;
  signal: AbortSignal;
  log: Log;
  /**
   * Extractions already paid for. Optional: a run with
   * `EXTRACTION_CACHE_TTL_HOURS=0` passes nothing and every call goes to the
   * model, which is exactly what this did before the cache existed.
   */
  cache?: ExtractionCache;
}

/**
 * The parts of a blob that can be cached SEPARATELY.
 *
 * A search blob is `{ results: [card, card, ...] }` and each card is its own
 * question — which is the granularity that makes the cache worth having, since
 * two runs over the same neighbourhood rarely batch the same cards together but
 * very often see the same cards. Anything else (an enrichment blob, which is
 * one detail page) is a single unit.
 *
 * Returns `undefined` for a shape with nothing addressable in it — a results
 * array holding a card with no name — which the caller reads as "do not cache
 * this call at all". A unit that cannot be matched back to what the model
 * returned cannot be stored under a key that means anything, and guessing is
 * how a cache starts answering the wrong question.
 */
export function cacheableUnits(blob: unknown): unknown[] | undefined {
  if (!blob || typeof blob !== "object") return undefined;
  const results = (blob as { results?: unknown }).results;
  if (Array.isArray(results)) {
    if (results.length === 0) return undefined;
    return results.every((r) => nameOf(r) !== undefined) ? results : undefined;
  }
  return nameOf(blob) === undefined ? undefined : [blob];
}

/** The `name` of a scraped unit, when it has one. Search cards carry it at the
 *  top level; an enrichment blob nests it under `place`. */
export function nameOf(unit: unknown): string | undefined {
  if (!unit || typeof unit !== "object") return undefined;
  const direct = (unit as { name?: unknown }).name;
  if (typeof direct === "string" && direct.trim() !== "") return direct;
  const place = (unit as { place?: { name?: unknown } }).place;
  const nested = place?.name;
  return typeof nested === "string" && nested.trim() !== "" ? nested : undefined;
}

/** Loose name match, so a unit can be paired with the place the model returned
 *  for it. Same normalisation the adapter uses to match answers to cards. */
export function sameName(a: string, b: string): boolean {
  return normalizeText(a) === normalizeText(b);
}

/**
 * File each fresh finding under the unit it came from, and store those.
 *
 * Attribution is by name, and a finding that matches no unit — or a unit that
 * matched none — is simply not cached. That is the whole safety property: a
 * failure to attribute costs a future cache miss, never a wrong hit. A unit
 * that legitimately produced NOTHING is cached as an empty array, because "the
 * model read this card and found no evidence" is an answer worth not paying
 * for twice.
 */
async function storeFresh(
  fresh: readonly PlaceFinding[],
  units: readonly unknown[],
  keyOf: ReadonlyMap<unknown, string>,
  args: ExtractFindingsArgs,
): Promise<void> {
  if (!args.cache) return;
  const entries: Array<{ key: string; findings: PlaceFinding[] }> = [];

  for (const unit of units) {
    const name = nameOf(unit);
    const key = keyOf.get(unit);
    if (name === undefined || key === undefined) continue;
    const mine = fresh.filter((f) => sameName(f.place.name, name));
    // Ambiguous: two units with the same name in one blob. Neither can be
    // stored without risking the other's answer.
    if (units.filter((u) => { const n = nameOf(u); return n !== undefined && sameName(n, name); }).length > 1) {
      continue;
    }
    entries.push({ key, findings: mine });
  }

  if (entries.length === 0) return;
  try {
    await args.cache.put(entries);
  } catch (err) {
    // A cache that cannot be written is a slow next run, never a failed one.
    await args.log("debug", `extraction cache unwritable (${describeError(err)})`);
  }
}

/** LLM path: blob -> `Extraction` -> findings. Retries once, then returns `[]`. */
export async function extractFindings(
  blob: unknown,
  args: ExtractFindingsArgs,
): Promise<PlaceFinding[]> {
  // --- cache lookup ------------------------------------------------------
  // Split the blob into per-place units, serve what is already known, and ask
  // the model only about the rest. A disabled cache, or a blob with nothing
  // addressable in it, falls straight through to the old behaviour.
  const units = args.cache ? cacheableUnits(blob) : undefined;
  const keyOf = new Map<unknown, string>();
  let cached = new Map<string, PlaceFinding[]>();
  let toAsk: unknown[] | undefined;

  if (args.cache && units) {
    const keyArgs = {
      source: args.source,
      requirements: args.requirements,
      uiLocale: args.uiLocale,
      searchLang: args.searchLang,
    };
    for (const unit of units) keyOf.set(unit, extractionCacheKey(unit, keyArgs));
    try {
      cached = await args.cache.get([...keyOf.values()]);
    } catch (err) {
      // A cache that cannot be read is a slow run, never a failed one.
      await args.log("debug", `extraction cache unreadable (${describeError(err)})`);
      cached = new Map();
    }
    toAsk = units.filter((unit) => !cached.has(keyOf.get(unit)!));
    const hits = units.length - toAsk.length;
    if (hits > 0) {
      await args.log(
        "info",
        `extraction cache: ${hits} of ${units.length} place(s) already known, ` +
          `asking the model about ${toAsk.length}`,
      );
    }
    // Everything was already known: no call, no tokens, no wait.
    if (toAsk.length === 0) return cachedFindings(cached, units, keyOf);
  }

  // Re-wrap only what is actually being asked about, so a cache hit takes its
  // place out of the PROMPT rather than merely out of the answer — that is
  // where the time and the tokens are.
  const askBlob =
    toAsk && Array.isArray((blob as { results?: unknown }).results)
      ? { ...(blob as object), results: toAsk }
      : blob;

  const blobText = JSON.stringify(askBlob ?? {});
  const system = buildExtractionSystemPrompt(args);
  const user = [
    "Extract every place in the JSON blob below and the evidence it contains.",
    'Copy each `quote` VERBATIM from the blob; if you have no quote use "" and polarity "unclear".',
    "",
    fenceUntrusted(`${args.source}_results`, blobText, 20_000),
  ].join("\n");

  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (args.signal.aborted) throw new Error("AbortError");
    try {
      const raw = await args.llm.completeStructured({
        system,
        user,
        schema: ExtractionSchema,
        temperature: 0,
        signal: args.signal,
      });
      const fresh = await buildFindingsFromExtraction(raw, {
        source: args.source,
        sourceUrl: args.sourceUrl,
        // The blob itself, not `blobText`: the guard matches against the source
        // STRINGS, never against their JSON encoding. `askBlob` rather than
        // `blob`, because a quote has to be verifiable against what the model
        // was actually shown, and a cache hit took its card out of that.
        blob: askBlob,
        log: args.log,
        keepUrls: false,
      });
      if (units && toAsk) await storeFresh(fresh, toAsk, keyOf, args);
      return cachedFindings(cached, units ?? [], keyOf).concat(fresh);
    } catch (err) {
      if (isAbortError(err)) throw err;
      lastError = err;
    }
  }

  await args.log(
    "warn",
    `extraction failed after one retry (${describeError(lastError)}) — skipping this page`,
  );
  // The cache hits are still real answers. A failed call for the REST of the
  // blob is no reason to throw away places the run already knows about.
  return cachedFindings(cached, units ?? [], keyOf);
}

/** Cached findings in the blob's own unit order, so a run that is entirely
 *  served from cache returns places in the same order a fresh one would. */
function cachedFindings(
  cached: ReadonlyMap<string, PlaceFinding[]>,
  units: readonly unknown[],
  keyOf: ReadonlyMap<unknown, string>,
): PlaceFinding[] {
  const out: PlaceFinding[] = [];
  for (const unit of units) {
    const key = keyOf.get(unit);
    if (key === undefined) continue;
    const hit = cached.get(key);
    if (hit) out.push(...hit);
  }
  return out;
}

function buildExtractionSystemPrompt(args: ExtractFindingsArgs): string {
  const requirementLines =
    args.requirements.length > 0
      ? args.requirements.flatMap((r) => {
          const lines = [
            `- ${r.id}: ${r.label}${r.must.length > 0 ? ` (must: ${r.must.join("; ")})` : ""}`,
          ];
          // The catalog's `satisfiedByHints`. `must` states the STRICT reading
          // ("dedicated gluten-free kitchen or documented GF protocol"), and
          // read literally it produced nonsense: a venue Google itself
          // categorises "Restaurant sans gluten" came back `unclear`, noting
          // "no explicit description of a dedicated gluten-free kitchen or
          // separate fryer". An entirely gluten-free kitchen IS a dedicated
          // gluten-free kitchen and has no gluten fryer to share. The strict
          // phrasing describes how a MIXED kitchen proves itself, which a
          // wholly-GF venue never has to do. State the equivalence rather than
          // hoping the model infers it.
          for (const hint of r.satisfiedBy) {
            lines.push(`    ALREADY SATISFIED IF: ${hint}`);
          }
          return lines;
        })
      : ["- (no specific requirements — capture general suitability claims)"];

  return [
    baseSystemPrompt({ uiLocale: args.uiLocale, searchLang: args.searchLang.code }),
    "",
    "EXTRACTION TASK",
    "You are given a JSON blob scraped from a place-search results page.",
    "Return the places it lists and, for each, evidence for or against these requirements:",
    ...requirementLines,
    'Use `requirementId` values from that list, or `custom_<slug>` for anything else the text raises.',
    "",
    "REQUIREMENTS THAT ARE ALREADY SATISFIED",
    "When an `ALREADY SATISFIED IF` condition above holds for a place, that",
    'requirement is `supports`, NOT `unclear`. Do not demand separately worded',
    "proof of a must that the condition has already met, and never report the",
    "stricter wording as missing. Quote the text that establishes the condition",
    "(a category, a name, a certification) as the evidence.",
    "",
    "CONFIDENCE",
    "Set `confidence` explicitly on every claim; it decides how much the claim",
    "counts for. Use 0.9 or more when the blob states the fact outright: a",
    "category field, an attribute chip, or a review-topic count such as",
    '"gluten free, mentioned in 89 reviews". Use about 0.6 for one passing',
    "review mention, and 0.3 or less for an inference. Omitting it is treated",
    "as a weak 0.5.",
  ].join("\n");
}
