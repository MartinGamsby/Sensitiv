import type { CreateJobInput } from "../src/jobs.ts";

/** A representative job-create payload for round-trip tests. */
export function sampleJobInput(userId: string): CreateJobInput {
  return {
    userId,
    location: {
      query: "Plateau-Mont-Royal, Montreal",
      city: "Montreal",
      region: "Quebec",
      country: "ca",
      postalCode: "H2T 1A1",
    },
    requestText: "gluten free brunch in the Plateau",
    requirements: [
      {
        id: "req_celiac",
        catalogId: "req_celiac",
        label: "Coeliac / gluten-free",
        intentIds: ["intent_dining"],
        must: ["dedicated gluten-free menu"],
        nice: ["separate fryer"],
        allergens: ["gluten"],
      },
    ],
    intentIds: ["intent_dining"],
    searchLang: "fr",
    uiLocale: "fr",
    timeoutSec: 480,
  };
}
