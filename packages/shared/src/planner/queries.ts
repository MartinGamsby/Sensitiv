import { getIntent, getRequirement, labelOf } from "../../catalog/index.ts";
import type { Location } from "../schema/location.ts";
import type { SearchLanguage, UiLocale } from "../schema/language.ts";
import type { PlannedRequirement } from "../schema/requirement.ts";

export type SearchQuery = {
  adapterId: string;
  intentId: string;
  query: string;
};

// Small localized term tables so we never call the LLM per query. Keyed by
// catalog id; `en` / `fr` at minimum. Anything missing falls back to the catalog
// label for the search language, then to the English label (via `labelOf`).
const INTENT_TERMS: Record<string, Partial<Record<string, string>>> = {
  dining: { en: "restaurant", fr: "restaurant" },
  grocery: { en: "grocery store", fr: "épicerie" },
  housing: { en: "apartment for rent", fr: "appartement à louer" },
  services: { en: "local service", fr: "service local" },
};

const REQUIREMENT_TERMS: Record<string, Partial<Record<string, string>>> = {
  celiac: { en: "gluten free", fr: "sans gluten" },
  allergy: { en: "allergy friendly", fr: "allergies alimentaires" },
  mold: { en: "mold free", fr: "sans moisissure" },
  diet: { en: "special diet", fr: "régime spécial" },
  access: { en: "wheelchair accessible", fr: "accessible en fauteuil roulant" },
};

/** Two-letter UI-locale-ish key from a BCP-47 code (`fr-CA` -> `fr`). */
function primaryLocale(code: string): UiLocale {
  return code.slice(0, 2).toLowerCase() === "fr" ? "fr" : "en";
}

function termFor(
  table: Record<string, Partial<Record<string, string>>>,
  id: string,
  code: string,
  fallbackLabel: string,
): string {
  const row = table[id];
  const primary = code.slice(0, 2).toLowerCase();
  return row?.[code] ?? row?.[primary] ?? fallbackLabel;
}

/**
 * Lowercase + strip diacritics + collapse whitespace, for COMPARISON only —
 * the emitted query text must never be mutated this way. Lets "Montréal" match
 * "Montreal" and "gluten free" match "GLUTEN  FREE".
 */
function normalizeForCompare(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * True when `needle`'s tokens appear as a contiguous run inside `haystack`'s
 * tokens (both normalized for comparison first). Token-sequence match, not
 * bare `includes` — `"grocery store"` matches inside `"gluten free grocery
 * store"`, but `"bar"` does not match inside `"barbecue"`.
 */
function containsTokenRun(haystack: string, needle: string): boolean {
  const hayTokens = normalizeForCompare(haystack).split(" ").filter((t) => t !== "");
  const needleTokens = normalizeForCompare(needle).split(" ").filter((t) => t !== "");
  if (needleTokens.length === 0) return false;
  for (let i = 0; i + needleTokens.length <= hayTokens.length; i++) {
    if (needleTokens.every((t, j) => hayTokens[i + j] === t)) return true;
  }
  return false;
}

/**
 * `location.query` + `postalCode` (when present) + `city` / `region` when they
 * are not already substrings of `query`. This is the plan2 "results in another
 * city" fix: always carry neighbourhood + city + region into the query string.
 */
export function locationPhrase(location: Location): string {
  const parts: string[] = [location.query];
  const haystack = normalizeForCompare(location.query);
  if (location.postalCode) parts.push(location.postalCode);
  for (const extra of [location.city, location.region]) {
    if (!extra) continue;
    if (haystack.includes(normalizeForCompare(extra))) continue;
    parts.push(extra);
  }
  return parts.join(" ");
}

/**
 * Drop `intentTerm` when `requirementTerm` already carries it. An LLM-authored
 * requirement is free text ("Mexican restaurant", "épicerie sans gluten"), and
 * the template used to append the intent term regardless — producing
 * "Mexican restaurant restaurant Montreal…", which Google Maps reads as a
 * different, worse query. Catalog requirements are unaffected: their terms
 * ("gluten free") never contain an intent term.
 */
function composeQuery(requirementTerm: string, intentTerm: string, phrase: string): string {
  const parts =
    requirementTerm !== "" && containsTokenRun(requirementTerm, intentTerm)
      ? [requirementTerm, phrase]
      : [requirementTerm, intentTerm, phrase];
  return parts
    .map((s) => s.trim())
    .filter((s) => s !== "")
    .join(" ");
}

export type BuildSearchQueriesArgs = {
  intentIds: readonly string[];
  requirements: readonly PlannedRequirement[];
  location: Location;
  searchLang: SearchLanguage;
};

/**
 * One to three search strings per (intent, adapter) pair, in `searchLang.code`.
 * Template: `<requirement term> <intent term> <location phrase>`. Per-intent
 * output is capped at the intent's `defaultLimit` so prompts stay bounded.
 */
export function buildSearchQueries(args: BuildSearchQueriesArgs): SearchQuery[] {
  const code = args.searchLang.code;
  const locale = primaryLocale(code);
  const phrase = locationPhrase(args.location);
  const out: SearchQuery[] = [];

  for (const intentId of args.intentIds) {
    const intent = getIntent(intentId);
    if (!intent) continue;

    const intentTerm = termFor(
      INTENT_TERMS,
      intentId,
      code,
      labelOf(intent, locale),
    );

    const matching = args.requirements
      .filter((r) => r.intentIds.includes(intentId))
      .slice(0, 3);
    const requirementTerms =
      matching.length > 0
        ? matching.map((r) =>
            r.catalogId
              ? termFor(
                  REQUIREMENT_TERMS,
                  r.catalogId,
                  code,
                  labelOf(getRequirement(r.catalogId), locale),
                )
              : r.label,
          )
        : [""];

    const perIntent: SearchQuery[] = [];
    const seen = new Set<string>();
    for (const adapterId of intent.adapters) {
      for (const requirementTerm of requirementTerms) {
        const query = composeQuery(requirementTerm, intentTerm, phrase);
        // Structural key, not string concatenation: a space separator would
        // let ("a b", "c") and ("a", "b c") collide. Deliberately NOT the
        // `\0` separator this line used before — a literal NUL byte makes git
        // treat this source file as binary, which it did until this change.
        const key = JSON.stringify([adapterId, query]);
        if (seen.has(key)) continue;
        seen.add(key);
        perIntent.push({ adapterId, intentId, query });
      }
    }
    out.push(...perIntent.slice(0, intent.defaultLimit));
  }

  return out;
}
