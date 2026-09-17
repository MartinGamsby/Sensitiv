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
import { canonicalKey } from "./merge.ts";
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
  /** `JSON.stringify` of the blob the extraction was produced from. */
  blobText: string;
  log: Log;
}

/**
 * Turn a validated `Extraction` into `PlaceFinding[]`. Drops any evidence whose
 * quote is not a verbatim substring of the blob (fabricated quote guard).
 */
export async function buildFindingsFromExtraction(
  extraction: Extraction,
  args: BuildFindingsArgs,
): Promise<PlaceFinding[]> {
  const findings: PlaceFinding[] = [];

  for (const raw of extraction.places) {
    const place = PlaceDetailSchema.parse({
      name: raw.name,
      address: raw.address,
      category: raw.category,
      phone: raw.phone,
      url: raw.url,
      lat: raw.lat,
      lng: raw.lng,
      canonicalKey: canonicalKey(raw.name, raw.address),
    });
    const sourceUrl = raw.url ?? args.sourceUrl;

    const evidence: Evidence[] = [];
    for (const ev of raw.evidence ?? []) {
      const quote = ev.quote ?? "";
      if (quote !== "" && !args.blobText.includes(quote)) {
        await args.log(
          "debug",
          `dropped an unverifiable quote for "${raw.name}" (${ev.requirementId})`,
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
}

/** LLM path: blob -> `Extraction` -> findings. Retries once, then returns `[]`. */
export async function extractFindings(
  blob: unknown,
  args: ExtractFindingsArgs,
): Promise<PlaceFinding[]> {
  const blobText = JSON.stringify(blob ?? {});
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
      return await buildFindingsFromExtraction(raw, {
        source: args.source,
        sourceUrl: args.sourceUrl,
        blobText,
        log: args.log,
      });
    } catch (err) {
      if (isAbortError(err)) throw err;
      lastError = err;
    }
  }

  await args.log(
    "warn",
    `extraction failed after one retry (${describeError(lastError)}) — skipping this page`,
  );
  return [];
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
