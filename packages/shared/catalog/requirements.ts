import type { UiLocale } from "../src/schema/index.ts";

// A requirement is *a constraint that activates intents and gives the planner
// must/nice hints*. Like intents, this list is the single source of truth —
// nothing downstream may hardcode a requirement `kind` union.
//
// Arrays are typed `readonly string[]` so the `as const` catalog below satisfies
// the shape AND ad-hoc entries built at runtime (mutable `string[]`) still
// assign cleanly.
export interface CatalogRequirement {
  /** Stable machine id. Plain string on purpose. */
  id: string;
  /** Display label per UI locale (en + fr are mandatory). */
  label: Record<UiLocale, string>;
  /** Catalog intent ids this requirement activates. Validated at runtime. */
  intents: readonly string[];
  /** UI sub-picker keys: `allergens` -> allergen multi-select, `diet` -> diet. */
  extraFields?: readonly string[];
  /** Planner "must have" hints. */
  mustHints: readonly string[];
  /** Planner "nice to have" hints. */
  niceHints: readonly string[];
  /** Phrases in source text that count against a place. */
  negativeHints: readonly string[];
}

const CATALOG_REQUIREMENTS = [
  {
    id: "celiac",
    label: { en: "Celiac", fr: "Maladie cœliaque" },
    intents: ["dining", "grocery"],
    mustHints: [
      "dedicated gluten-free kitchen or documented GF protocol",
      "separate fryer if fried food",
    ],
    niceHints: ["GF menu published", "staff trained"],
    negativeHints: ["cross-contamination", "got glutened", "shared fryer only"],
  },
  {
    id: "allergy",
    label: { en: "Food allergy", fr: "Allergie alimentaire" },
    intents: ["dining", "grocery"],
    extraFields: ["allergens"],
    mustHints: ["allergen menu or explicit protocol"],
    niceHints: [],
    negativeHints: ["cross-contact", "cannot guarantee"],
  },
  {
    id: "mold",
    label: { en: "Rental mold", fr: "Moisissure en location" },
    intents: ["housing", "services"],
    mustHints: ["recent inspection", "remediation mentioned", "dry basement"],
    niceHints: [],
    negativeHints: ["musty", "leak", "mold", "landlord ignored"],
  },
  {
    id: "diet",
    label: { en: "Special diet", fr: "Régime particulier" },
    intents: ["dining", "grocery"],
    extraFields: ["diet"],
    mustHints: [],
    niceHints: [],
    negativeHints: [],
  },
  {
    id: "access",
    label: { en: "Wheelchair access", fr: "Accès fauteuil roulant" },
    intents: ["dining", "housing", "services"],
    mustHints: ["step-free entrance", "accessible washroom"],
    niceHints: [],
    negativeHints: [],
  },
] as const satisfies readonly CatalogRequirement[];

/** Union of catalog requirement ids — INTERNAL convenience only. */
export type RequirementId = (typeof CATALOG_REQUIREMENTS)[number]["id"];

/** The requirement catalog. Widened to `CatalogRequirement` so consumers see a
 * uniform shape; the `satisfies` above still enforces integrity at compile time. */
export const requirements: readonly CatalogRequirement[] = CATALOG_REQUIREMENTS;

// ---------------------------------------------------------------------------
// Sub-picker option lists. `extraFields` on a requirement points at one of
// these. Exported from here so Section 9's UI (and Section 6's planner) never
// invent their own list.
// ---------------------------------------------------------------------------

export interface CatalogOption {
  id: string;
  label: Record<UiLocale, string>;
}

/** `extraFields: ["allergens"]` -> this multi-select (Canada priority allergens). */
export const allergenOptions = [
  { id: "peanut", label: { en: "Peanut", fr: "Arachide" } },
  { id: "tree_nut", label: { en: "Tree nut", fr: "Noix" } },
  { id: "milk", label: { en: "Milk", fr: "Lait" } },
  { id: "egg", label: { en: "Egg", fr: "Œuf" } },
  { id: "wheat", label: { en: "Wheat", fr: "Blé" } },
  { id: "soy", label: { en: "Soy", fr: "Soja" } },
  { id: "sesame", label: { en: "Sesame", fr: "Sésame" } },
  { id: "fish", label: { en: "Fish", fr: "Poisson" } },
  { id: "shellfish", label: { en: "Shellfish", fr: "Crustacés et mollusques" } },
  { id: "mustard", label: { en: "Mustard", fr: "Moutarde" } },
  { id: "sulphites", label: { en: "Sulphites", fr: "Sulfites" } },
] as const satisfies readonly CatalogOption[];

/** `extraFields: ["diet"]` -> this single-select. */
export const dietOptions = [
  { id: "halal", label: { en: "Halal", fr: "Halal" } },
  { id: "kosher", label: { en: "Kosher", fr: "Cascher" } },
  { id: "low_fodmap", label: { en: "Low-FODMAP", fr: "Pauvre en FODMAP" } },
  { id: "histamine", label: { en: "Low-histamine", fr: "Pauvre en histamine" } },
  { id: "other", label: { en: "Other", fr: "Autre" } },
] as const satisfies readonly CatalogOption[];
