import { describe, expect, it } from "vitest";
import {
  intents,
  KNOWN_ADAPTER_IDS,
  PLANNED_ADAPTER_IDS,
  REFUSED_ADAPTER_IDS,
} from "./intents.ts";

describe("intents catalog", () => {
  it("declares the four v1 intents", () => {
    expect(intents.map((intent) => intent.id)).toEqual([
      "dining",
      "grocery",
      "housing",
      "services",
    ]);
  });

  it("gives every intent en + fr labels", () => {
    for (const intent of intents) {
      expect(intent.label.en.length).toBeGreaterThan(0);
      expect(intent.label.fr.length).toBeGreaterThan(0);
    }
  });

  it("lists at least one non-empty string adapter per intent", () => {
    for (const intent of intents) {
      expect(intent.adapters.length).toBeGreaterThan(0);
      for (const adapter of intent.adapters) {
        expect(typeof adapter).toBe("string");
        expect(adapter.trim()).not.toBe("");
      }
    }
  });

  it("has a positive defaultLimit, with housing at 12", () => {
    for (const intent of intents) {
      expect(intent.defaultLimit).toBeGreaterThan(0);
    }
    expect(intents.find((intent) => intent.id === "housing")?.defaultLimit).toBe(12);
  });

  it("every adapter id is either implemented or documented as planned", () => {
    const documented = new Set<string>([...KNOWN_ADAPTER_IDS, ...PLANNED_ADAPTER_IDS]);
    for (const intent of intents) {
      for (const adapter of intent.adapters) {
        expect(documented.has(adapter)).toBe(true);
      }
    }
  });

  it("does not leave any planned adapter id unused (keeps the list honest)", () => {
    const used = new Set(intents.flatMap((intent) => [...intent.adapters]));
    for (const planned of PLANNED_ADAPTER_IDS) {
      expect(used.has(planned)).toBe(true);
    }
  });

  it("never lists a source we have decided not to build", () => {
    // Yelp and Find Me Gluten Free forbid automated agents in terms we are
    // bound by, so an intent that names one is promising a run it must not
    // make. They were briefly registered as no-ops, which is how the dossier
    // came to tell readers they had "run but contributed nothing".
    const used = new Set(intents.flatMap((intent) => [...intent.adapters]));
    for (const refused of REFUSED_ADAPTER_IDS) {
      expect(used.has(refused)).toBe(false);
    }
  });

  it("keeps planned and refused apart — an id cannot be both", () => {
    const planned = new Set<string>(PLANNED_ADAPTER_IDS);
    for (const refused of REFUSED_ADAPTER_IDS) {
      expect(planned.has(refused)).toBe(false);
    }
  });
});
