import type { UiLocale } from "../src/schema/index.ts";

// An intent is *where to look and which adapters to run*. This list is the only
// place the set of intents is defined — business logic elsewhere MUST look ids
// up here (getIntent / isValidIntentId), never switch on a hardcoded union.
export interface Intent {
  /** Stable machine id. Plain string on purpose. */
  id: string;
  /** Display label per UI locale (en + fr are mandatory). */
  label: Record<UiLocale, string>;
  /** Adapter ids to run for this intent, in preference order. */
  adapters: readonly string[];
  /** Default number of places to keep in the dossier for this intent. */
  defaultLimit: number;
}

// An intent's `adapters` list is a promise about what a run of that intent
// WILL TRY. Ids that are merely unbuilt may sit here — the registry logs and
// skips them, and a roadmap in the source of truth is worth having. Ids we
// have DECIDED not to build must not: see `REFUSED_ADAPTER_IDS`.
const CATALOG_INTENTS = [
  {
    id: "dining",
    label: { en: "Dining", fr: "Restauration" },
    // No `yelp` / `find_me_gluten_free`: both are refused on policy, not
    // pending. See `REFUSED_ADAPTER_IDS`.
    adapters: ["google_maps", "openstreetmap"],
    defaultLimit: 8,
  },
  {
    id: "grocery",
    label: { en: "Grocery", fr: "Épicerie" },
    adapters: ["google_maps", "openstreetmap", "store_locator"],
    defaultLimit: 8,
  },
  {
    id: "housing",
    label: { en: "Housing", fr: "Logement" },
    adapters: ["google_maps", "kijiji", "craigslist"],
    defaultLimit: 12,
  },
  {
    id: "services",
    label: { en: "Local services", fr: "Services" },
    adapters: ["google_maps"],
    defaultLimit: 8,
  },
] as const satisfies readonly Intent[];

/** Union of catalog intent ids — for INTERNAL convenience only. Public function
 * signatures take `string` so ad-hoc / LLM-produced ids still flow through. */
export type IntentId = (typeof CATALOG_INTENTS)[number]["id"];

/** The intent catalog. Widened to `Intent` so consumers see a uniform shape;
 * compile-time integrity is still enforced by the `satisfies` above. */
export const intents: readonly Intent[] = CATALOG_INTENTS;

/**
 * Adapter ids with a real extraction path in this run. Kept here so the catalog
 * integrity test can assert every declared adapter id is either implemented or
 * an intentional placeholder.
 *
 * `openstreetmap` reads the Overpass API rather than driving a browser, and it
 * needs no credentials of any kind — it is the one source that returns real
 * results from an empty `.env`.
 */
export const KNOWN_ADAPTER_IDS = ["google_maps", "openstreetmap"] as const;

/**
 * Adapter ids declared ahead of a real implementation — work that is not done
 * yet, not work that has been ruled out.
 *
 * None of these is registered in the worker, so an intent that lists one hits
 * the registry's log-and-skip path and the run carries on. That is the only
 * degradation left: nothing "runs and contributes nothing" any more.
 */
export const PLANNED_ADAPTER_IDS = [
  "store_locator",
  "kijiji",
  "craigslist",
] as const;

/**
 * Adapter ids we have decided NOT to build, and which therefore must not
 * appear in any intent's `adapters` list.
 *
 * Both of these forbid automated agents in terms we are bound by: Yelp's
 * robots.txt prohibits any automated retrieval of its content, and Find Me
 * Gluten Free names `anthropic-ai` / `ClaudeBot` / `GPTBot` by user agent and
 * disallows every listing path. Sensitiv is one of those agents.
 *
 * They were briefly shipped as registered no-op adapters, which meant every
 * dining run "ran" them, recorded a source mode for them, and told the reader
 * they were "not implemented yet, so they ran but contributed nothing" — three
 * claims, of which the first was pointless work and the last two were wrong.
 * The list exists so a future intent cannot quietly add them back: the catalog
 * integrity test asserts no intent references one.
 *
 * `openstreetmap` is the second real source instead — ODbL open data on a
 * documented public API. See `memory/security-invariants.md`.
 */
export const REFUSED_ADAPTER_IDS = ["yelp", "find_me_gluten_free"] as const;
