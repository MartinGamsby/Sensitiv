// Registers every adapter this build ships. NOT kijiji / craigslist — housing is
// out of scope; the registry's unknown-id skip covers a housing job that unions
// them.
import { AdapterRegistry } from "../registry.ts";
import { googleMapsAdapter } from "./google-maps.ts";
import { openStreetMapAdapter } from "./openstreetmap.ts";
import { findMeGlutenFreeAdapter } from "./find-me-gluten-free.ts";
import { storeLocatorAdapter } from "./store-locator.ts";
import { yelpAdapter } from "./yelp.ts";

export function createDefaultRegistry(): AdapterRegistry {
  return new AdapterRegistry()
    .register(googleMapsAdapter)
    .register(openStreetMapAdapter)
    .register(yelpAdapter)
    .register(findMeGlutenFreeAdapter)
    .register(storeLocatorAdapter);
}

export {
  googleMapsAdapter,
  openStreetMapAdapter,
  yelpAdapter,
  findMeGlutenFreeAdapter,
  storeLocatorAdapter,
};
