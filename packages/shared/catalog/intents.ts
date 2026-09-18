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

// NOTE: `kijiji` and `craigslist` are declared but NOT implemented in v1
// (housing is deferred). The Section 7 registry logs + skips unknown adapter
// ids, so leaving them here is the designed behaviour, not a bug.
const CATALOG_INTENTS = [
  {
    id: "dining",
    label: { en: "Dining", fr: "Restauration" },
    adapters: ["google_maps", "openstreetmap", "yelp", "find_me_gluten_free"],
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
 * Adapter ids declared ahead of a real implementation. Listing them here is what
 * keeps the integrity test green while documenting the intent.
 *
 * Two different degradations hide behind this one list, so do not read it as
 * "these all get skipped":
 *   - `yelp`, `find_me_gluten_free`, `store_locator` ARE registered in the
 *     worker (`apps/worker/src/adapters/`) as stubs that log and return no
 *     findings, so they run and contribute nothing. `yelp` and
 *     `find_me_gluten_free` are unlikely ever to become real: both sites
 *     explicitly forbid automated agents (Yelp's robots.txt prohibits any
 *     automated retrieval of its content; Find Me Gluten Free names
 *     `anthropic-ai` / `ClaudeBot` / `GPTBot` and disallows every listing
 *     path). `openstreetmap` is the second real source instead;
 *   - `kijiji` and `craigslist` are not registered at all (housing is out of
 *     scope), so they are the ids that actually hit the registry's log-and-skip
 *     path.
 */
export const PLACEHOLDER_ADAPTER_IDS = [
  "yelp",
  "find_me_gluten_free",
  "store_locator",
  "kijiji",
  "craigslist",
] as const;
