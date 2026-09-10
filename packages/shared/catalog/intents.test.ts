import { describe, expect, it } from "vitest";
import { intents, KNOWN_ADAPTER_IDS, PLACEHOLDER_ADAPTER_IDS } from "./intents.ts";

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

  it("every adapter id is either implemented or a documented placeholder", () => {
    const documented = new Set<string>([...KNOWN_ADAPTER_IDS, ...PLACEHOLDER_ADAPTER_IDS]);
    for (const intent of intents) {
      for (const adapter of intent.adapters) {
        expect(documented.has(adapter)).toBe(true);
      }
    }
  });

  it("does not leave any placeholder adapter id unused (keeps the list honest)", () => {
    const used = new Set(intents.flatMap((intent) => [...intent.adapters]));
    for (const placeholder of PLACEHOLDER_ADAPTER_IDS) {
      expect(used.has(placeholder)).toBe(true);
    }
  });
});
