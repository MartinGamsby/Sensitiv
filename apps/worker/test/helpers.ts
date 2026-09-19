import {
  createDb,
  createJob,
  getOrCreateLocalUser,
  runMigrations,
  type CreateJobInput,
  type DbHandle,
  type Job,
} from "@sensitiv/db";
import type { Client } from "@libsql/client";

export interface TestDb {
  db: DbHandle;
  client: Client;
}

/** A freshly migrated, isolated in-memory database. `client.close()` when done. */
export async function makeDb(): Promise<TestDb> {
  const { db, client } = await createDb(":memory:");
  await runMigrations(db);
  return { db, client };
}

const CELIAC_REQUIREMENT = {
  id: "celiac",
  catalogId: "celiac",
  label: "Celiac",
  intentIds: ["dining"],
  must: ["dedicated gluten-free kitchen"],
  nice: [],
  allergens: ["gluten"],
  weight: 3,
  satisfiedBy: [],
};

const MOLD_REQUIREMENT = {
  id: "mold",
  catalogId: "mold",
  label: "Rental mold",
  intentIds: ["housing"],
  must: ["recent inspection"],
  nice: [],
  weight: 3,
  satisfiedBy: [],
};

/** The same chip with `grocery` ticked as well. Separate because it is now a
 *  deliberate choice a user makes in the form, not what `celiac` means on its
 *  own — see `defaultIntentsFor`. */
const CELIAC_GROCERY_REQUIREMENT = {
  ...CELIAC_REQUIREMENT,
  intentIds: ["dining", "grocery"],
};

/** Insert a queued job. `variant` picks a requirement set; `overrides` win. */
export async function seedJob(
  db: DbHandle,
  opts: {
    variant?: "celiac" | "celiacGrocery" | "mold";
    overrides?: Partial<CreateJobInput>;
  } = {},
): Promise<Job> {
  const user = await getOrCreateLocalUser(db);
  const celiac = opts.variant !== "mold";
  const input: CreateJobInput = {
    userId: user.id,
    location: {
      query: "Plateau-Mont-Royal, Montreal",
      city: "Montreal",
      region: "Quebec",
      country: "ca",
      postalCode: "H2T 1A1",
    },
    requestText: celiac
      ? "gluten free brunch in the Plateau"
      : "apartment with no mold history in the Plateau",
    requirements: [
      opts.variant === "celiacGrocery"
        ? CELIAC_GROCERY_REQUIREMENT
        : celiac
          ? CELIAC_REQUIREMENT
          : MOLD_REQUIREMENT,
    ],
    intentIds:
      opts.variant === "celiacGrocery"
        ? ["dining", "grocery"]
        : celiac
          ? ["dining"]
          : ["housing"],
    searchLang: "fr",
    uiLocale: "fr",
    timeoutSec: 480,
    ...opts.overrides,
  };
  return createJob(db, input);
}
