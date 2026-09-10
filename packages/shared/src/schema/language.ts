import { z } from "zod";
import type { Location } from "./location.ts";

// The language searches are actually run in (BCP 47). `source` records whether
// the user pinned it or we inferred it from the location.
export const SearchLanguageSchema = z.object({
  code: z.string().trim().min(2),
  source: z.enum(["auto", "user"]),
});
export type SearchLanguage = z.infer<typeof SearchLanguageSchema>;

// The UI ships in English (default) and French only.
export const UiLocaleSchema = z.enum(["en", "fr"]);
export type UiLocale = z.infer<typeof UiLocaleSchema>;

// Country -> majority search language. Plain Record so it is trivial to extend.
export const COUNTRY_LANGUAGE: Record<string, string> = {
  CA: "en",
  FR: "fr",
  BE: "nl",
  DE: "de",
  ES: "es",
  IT: "it",
  MX: "es",
  BR: "pt",
  NL: "nl",
  PT: "pt",
  US: "en",
  GB: "en",
  JP: "ja",
  CN: "zh",
};

const QUEBEC_REGION = new Set(["quebec", "québec", "qc"]);

/**
 * Resolve which language to run searches in.
 * 1. explicit userDefault wins;
 * 2. a Quebec region -> fr;
 * 3. country majority language from the lookup table;
 * 4. otherwise English.
 */
export function resolveSearchLanguage(
  location: Pick<Location, "region" | "country">,
  userDefault?: string | null,
): SearchLanguage {
  if (userDefault != null && userDefault.trim() !== "") {
    return { code: userDefault.trim(), source: "user" };
  }

  const region = location.region?.trim().toLowerCase();
  if (region && QUEBEC_REGION.has(region)) {
    return { code: "fr", source: "auto" };
  }

  const country = location.country?.trim().toUpperCase();
  const byCountry = country ? COUNTRY_LANGUAGE[country] : undefined;
  if (byCountry) {
    return { code: byCountry, source: "auto" };
  }

  return { code: "en", source: "auto" };
}

const DISCLAIMERS: Record<UiLocale, string> = {
  en: "This is research assistance, not medical, legal, or housing advice.",
  fr: "Ceci est une aide à la recherche, et non un avis médical, juridique ou immobilier.",
};

/** The mandatory dossier disclaimer, in the given UI locale. */
export function disclaimerFor(uiLocale: UiLocale): string {
  return DISCLAIMERS[uiLocale];
}
