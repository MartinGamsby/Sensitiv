// Registers every adapter this build ships — and only adapters that actually
// do something.
//
// There used to be three more here (`yelp`, `find_me_gluten_free`,
// `store_locator`) registered as no-ops that logged a line and returned
// `{findings: []}`. They cost a slot in every dining/grocery run, recorded a
// `"stub"` source mode, and made the dossier tell the reader they had "run but
// contributed nothing" — which was true and useless — under a heading that
// said they were "not implemented yet", which for two of them was false: Yelp
// and Find Me Gluten Free are refused on policy and are not coming. See
// `REFUSED_ADAPTER_IDS` in the catalog.
//
// Nothing replaces them. An intent that still lists an unbuilt id
// (`store_locator`, `kijiji`, `craigslist`) hits the registry's log-and-skip
// path, which is what that path is for.
import { AdapterRegistry } from "../registry.ts";
import { googleMapsAdapter } from "./google-maps.ts";
import { openStreetMapAdapter } from "./openstreetmap.ts";

export function createDefaultRegistry(): AdapterRegistry {
  return new AdapterRegistry()
    .register(googleMapsAdapter)
    .register(openStreetMapAdapter);
}

export { googleMapsAdapter, openStreetMapAdapter };
