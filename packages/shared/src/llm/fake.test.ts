import { describe, expect, it } from "vitest";
import { z } from "zod";
import { FakeLlmProvider, minimalValueFor } from "./fake.ts";
import { EvidenceSchema } from "../schema/index.ts";
import { LlmError } from "./types.ts";

const schema = z.object({
  name: z.string().min(1),
  score: z.number().min(0).max(10),
  tags: z.array(z.string()),
});

describe("FakeLlmProvider", () => {
  it("returns canned responses in order and records every call", async () => {
    const provider = new FakeLlmProvider({
      responses: [
        { name: "A", score: 1, tags: [] },
        { name: "B", score: 2, tags: ["x"] },
      ],
    });

    expect(await provider.completeStructured({ system: "s", user: "u1", schema })).toEqual({
      name: "A",
      score: 1,
      tags: [],
    });
    expect(await provider.completeStructured({ system: "s", user: "u2", schema })).toEqual({
      name: "B",
      score: 2,
      tags: ["x"],
    });
    expect(provider.calls.map((c) => c.user)).toEqual(["u1", "u2"]);
  });

  it("still runs the caller's schema over a canned value", async () => {
    const provider = new FakeLlmProvider({ responses: [{ name: "", score: 99, tags: [] }] });
    const err = await provider
      .completeStructured({ system: "s", user: "u", schema })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LlmError);
    expect((err as LlmError).kind).toBe("schema");
  });

  it("supports a handler that computes the response from the args", async () => {
    const provider = new FakeLlmProvider({
      handler: (args) => ({ name: args.user.toUpperCase(), score: 5, tags: [] }),
    });
    const out = await provider.completeStructured({ system: "s", user: "cafe", schema });
    expect(out).toEqual({ name: "CAFE", score: 5, tags: [] });
  });

  it("derives a schema-valid minimal object when given no responses", async () => {
    const provider = new FakeLlmProvider();
    const out = await provider.completeStructured({
      system: "s",
      user: "u",
      schema: EvidenceSchema,
    });
    expect(() => EvidenceSchema.parse(out)).not.toThrow();
  });

  it("throws a helpful error when it cannot derive a value", async () => {
    const provider = new FakeLlmProvider();
    const weird = z.function();
    const err = await provider
      .completeStructured({
        system: "s",
        user: "u",
        schema: weird as unknown as z.ZodType<unknown>,
      })
      .catch((e: unknown) => e);
    expect((err as LlmError).message).toContain("no canned response");
  });
});

describe("minimalValueFor", () => {
  it("respects string/number constraints and enum members", () => {
    const g = minimalValueFor(
      z.object({
        polarity: z.enum(["supports", "contradicts", "unclear"]),
        conf: z.number().min(0).max(1),
        note: z.string().min(3),
      }) as z.ZodType<unknown>,
    );
    expect(g).toEqual({
      ok: true,
      value: { polarity: "supports", conf: 0, note: "fixture" },
    });
  });
});
