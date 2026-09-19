import { describe, expect, it } from "vitest";
import { PlannedRequirementSchema } from "../src/schema/index.ts";
import { intents } from "./intents.ts";
import {
  adapterIdsFor,
  catalogPromptSummary,
  getIntent,
  getRequirement,
  intentsForRequirements,
  isValidIntentId,
  isValidRequirementId,
  labelOf,
  makeCustomRequirement,
  slugify,
  toPlannedRequirement,
  validateIntentIds,
  validateRequirementIds,
} from "./index.ts";

describe("point lookups", () => {
  it("getIntent / getRequirement return the entry or undefined", () => {
    expect(getIntent("dining")?.id).toBe("dining");
    expect(getIntent("banana")).toBeUndefined();
    expect(getRequirement("celiac")?.id).toBe("celiac");
    expect(getRequirement("banana")).toBeUndefined();
  });

  it("isValid* guards", () => {
    expect(isValidIntentId("housing")).toBe(true);
    expect(isValidIntentId("custom_thing")).toBe(false);
    expect(isValidRequirementId("mold")).toBe(true);
    expect(isValidRequirementId("mould")).toBe(false);
  });
});

describe("batch validation (the second channel)", () => {
  it("partitions valid vs unknown, preserving order", () => {
    expect(validateIntentIds(["dining", "banana", "housing"])).toEqual({
      valid: ["dining", "housing"],
      unknown: ["banana"],
    });
    expect(validateRequirementIds(["celiac", "nope"])).toEqual({
      valid: ["celiac"],
      unknown: ["nope"],
    });
  });
});

describe("intentsForRequirements", () => {
  it("returns deduped intent ids in catalog declaration order", () => {
    expect(intentsForRequirements(["celiac", "mold"])).toEqual([
      "dining",
      "grocery",
      "housing",
      "services",
    ]);
  });

  it("does not throw on an unknown requirement id and still resolves the rest", () => {
    expect(() => intentsForRequirements(["celiac", "banana"])).not.toThrow();
    expect(intentsForRequirements(["celiac", "banana"])).toEqual(["dining", "grocery"]);
    expect(validateRequirementIds(["celiac", "banana"]).unknown).toEqual(["banana"]);
  });

  it("is order-independent of the caller's input", () => {
    expect(intentsForRequirements(["mold", "celiac"])).toEqual(
      intentsForRequirements(["celiac", "mold"]),
    );
  });
});

describe("adapterIdsFor", () => {
  it("returns the deduped union in catalog order, google_maps once", () => {
    const adapters = adapterIdsFor(["dining", "grocery"]);
    // `store_locator` is still here and still unbuilt — the registry logs and
    // skips it. `yelp` / `find_me_gluten_free` are gone for good: an intent
    // may promise work that is pending, never work we have refused.
    expect(adapters).toEqual(["google_maps", "openstreetmap", "store_locator"]);
    // Both intents declare these two; the union must not run either twice.
    expect(adapters.filter((a) => a === "google_maps")).toHaveLength(1);
    expect(adapters.filter((a) => a === "openstreetmap")).toHaveLength(1);
  });

  it("drops unknown intent ids without throwing", () => {
    expect(() => adapterIdsFor(["dining", "banana"])).not.toThrow();
    expect(adapterIdsFor(["banana"])).toEqual([]);
  });
});

describe("labelOf", () => {
  it("resolves the requested locale", () => {
    expect(labelOf(getRequirement("mold"), "fr")).toBe("Moisissure en location");
    expect(labelOf(getIntent("dining"), "en")).toBe("Dining");
  });

  it("falls back to en for an unknown locale, then never returns undefined", () => {
    expect(labelOf(getRequirement("mold"), "de" as "en")).toBe("Rental mold");
    expect(labelOf(undefined, "en")).toBe("");
  });
});

describe("toPlannedRequirement", () => {
  it("maps a chip to a schema-valid PlannedRequirement", () => {
    const planned = toPlannedRequirement("celiac", "fr");
    expect(() => PlannedRequirementSchema.parse(planned)).not.toThrow();
    expect(planned.id).toBe("celiac");
    expect(planned.catalogId).toBe("celiac");
    expect(planned.label).toBe("Maladie cœliaque");
    // The chip's FIRST intent, not every intent it declares. `celiac` lists
    // dining AND grocery because it can apply to either, and reading that list
    // as "search both" is how a run for a Mexican restaurant also searched for
    // grocery stores.
    expect(planned.intentIds).toEqual(["dining"]);
    expect(planned.must.length).toBeGreaterThan(0);
  });

  it("searches exactly the intents it is given, in catalog order", () => {
    expect(
      toPlannedRequirement("celiac", "en", undefined, ["grocery", "dining"])
        .intentIds,
    ).toEqual(["dining", "grocery"]);
    expect(
      toPlannedRequirement("celiac", "en", undefined, ["grocery"]).intentIds,
    ).toEqual(["grocery"]);
  });

  it("drops an intent the requirement does not declare instead of searching it", () => {
    // Fail closed, as everywhere else in the catalog: neither an intent that
    // exists but is not this chip's, nor one that does not exist at all, may
    // widen the run. An all-dropped list falls back to the default rather than
    // leaving the requirement with nowhere to look.
    expect(
      toPlannedRequirement("celiac", "en", undefined, ["dining", "housing"])
        .intentIds,
    ).toEqual(["dining"]);
    expect(
      toPlannedRequirement("celiac", "en", undefined, ["housing", "nope"])
        .intentIds,
    ).toEqual(["dining"]);
  });

  it("a chip is never the subject of the search", () => {
    // "celiac" is a property a place has, not a kind of place. Only the
    // planner's free-text requirements can be a `subject` — see `scorePlace`.
    expect(toPlannedRequirement("celiac", "en").kind).toBe("preference");
  });

  it("carries allergen / diet extras through", () => {
    const planned = toPlannedRequirement("allergy", "en", {
      allergens: ["peanut", "sesame", ""],
    });
    expect(planned.allergens).toEqual(["peanut", "sesame"]);
    const withDiet = toPlannedRequirement("diet", "en", { diet: "halal" });
    expect(withDiet.diet).toBe("halal");
  });

  it("only applies an extra to a requirement that declares the field", () => {
    // The caller passes ONE extras bag for the whole form, so a Celiac+Allergy
    // or Diet+Access run must not smear the sub-picker values across chips.
    const extras = { allergens: ["peanut"], diet: "halal" };

    const celiac = toPlannedRequirement("celiac", "en", extras);
    expect(celiac.allergens).toBeUndefined();
    expect(celiac.diet).toBeUndefined();

    const access = toPlannedRequirement("access", "en", extras);
    expect(access.allergens).toBeUndefined();
    expect(access.diet).toBeUndefined();

    // ...while the requirements that DO declare the field still get it.
    expect(toPlannedRequirement("allergy", "en", extras).allergens).toEqual([
      "peanut",
    ]);
    expect(toPlannedRequirement("allergy", "en", extras).diet).toBeUndefined();
    expect(toPlannedRequirement("diet", "en", extras).diet).toBe("halal");
    expect(toPlannedRequirement("diet", "en", extras).allergens).toBeUndefined();
  });

  it("throws on an id that is not in the catalog (chip ids are trusted input)", () => {
    expect(() => toPlannedRequirement("banana", "en")).toThrow();
  });
});

describe("makeCustomRequirement", () => {
  it("builds a slugified custom id", () => {
    const planned = makeCustomRequirement(
      "Mold-free 3½ near a métro",
      ["housing"],
      ["recent inspection"],
    );
    expect(planned.id).toMatch(/^custom_[a-z0-9_]{1,40}$/);
    expect(planned.intentIds).toEqual(["housing"]);
    expect(() => PlannedRequirementSchema.parse(planned)).not.toThrow();
  });

  it("drops unknown intent ids (fail closed) and never throws on them", () => {
    const planned = makeCustomRequirement("quiet street", ["housing", "banana"], []);
    expect(planned.intentIds).toEqual(["housing"]);
  });
});

describe("slugify", () => {
  it("lowercases, strips accents, collapses separators, caps at 40", () => {
    expect(slugify("Mold-free 3½ near a métro")).toMatch(/^[a-z0-9_]{1,40}$/);
    expect(slugify("  ---  ")).toBe("request");
    expect(slugify("")).toBe("request");
    expect(slugify("a".repeat(80)).length).toBe(40);
    expect(slugify("Café Déjà Vu")).toBe("cafe_deja_vu");
  });
});

describe("catalogPromptSummary", () => {
  it("contains every intent id so the planner prompt cannot drift", () => {
    const summary = catalogPromptSummary("en");
    for (const intent of intents) {
      expect(summary).toContain(intent.id);
    }
  });

  it("contains every requirement id too", () => {
    const summary = catalogPromptSummary("fr");
    expect(summary).toContain("celiac");
    expect(summary).toContain("access");
  });
});
