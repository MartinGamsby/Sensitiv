import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  generateObject,
  JSONParseError,
  NoObjectGeneratedError,
  TypeValidationError,
} from "ai";
import { AnthropicProvider, DEFAULT_ANTHROPIC_MODEL } from "./anthropic.ts";
import { LlmError, type LlmLogEvent } from "./types.ts";

// Only `generateObject` is faked — the real error classes are kept, because the
// whole point of these tests is that the provider handles what the SDK actually
// throws (ai@4: `generateObject` validates against the passed schema itself and
// REJECTS on a mismatch; it never resolves with an object that failed).
vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return { ...actual, generateObject: vi.fn() };
});
vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: () => (modelId: string) => ({ modelId }),
}));

const mockGen = vi.mocked(generateObject);

const schema = z.object({ ok: z.boolean(), name: z.string().min(1) });
const API_KEY = "sk-ant-super-secret-test-key";
const USER_PROMPT = "SECRET USER PAYLOAD: scraped review text here";

type GenResult = Awaited<ReturnType<typeof generateObject>>;
const USAGE = { promptTokens: 12, completionTokens: 7, totalTokens: 19 };

function genResult(object: unknown): GenResult {
  return { object, usage: USAGE } as unknown as GenResult;
}

/** Exactly what `generateObject` throws when the model's JSON misses the schema. */
function schemaRejection(object: unknown): NoObjectGeneratedError {
  const parsed = schema.safeParse(object);
  return new NoObjectGeneratedError({
    message: "No object generated: response did not match schema.",
    cause: TypeValidationError.wrap({
      value: object,
      cause: parsed.success ? new Error("unexpected") : parsed.error,
    }),
    text: JSON.stringify(object),
    response: {
      id: "resp_1",
      timestamp: new Date(0),
      modelId: DEFAULT_ANTHROPIC_MODEL,
    },
    usage: USAGE,
    finishReason: "stop",
  });
}

/** …and what it throws when the response is not JSON at all. */
function unparseableRejection(text: string): NoObjectGeneratedError {
  return new NoObjectGeneratedError({
    message: "No object generated: could not parse the response.",
    cause: new JSONParseError({ text, cause: new Error("Unexpected token") }),
    text,
    response: {
      id: "resp_1",
      timestamp: new Date(0),
      modelId: DEFAULT_ANTHROPIC_MODEL,
    },
    usage: USAGE,
    finishReason: "stop",
  });
}

beforeEach(() => {
  mockGen.mockReset();
});

describe("AnthropicProvider.completeStructured", () => {
  it("retries once when the SDK rejects on a schema miss, then returns the valid object", async () => {
    mockGen.mockRejectedValueOnce(schemaRejection({ ok: "not-a-bool" }));
    mockGen.mockResolvedValueOnce(genResult({ ok: true, name: "Cafe" }));

    const provider = new AnthropicProvider({ apiKey: API_KEY });
    const out = await provider.completeStructured({
      system: "sys",
      user: USER_PROMPT,
      schema,
    });

    expect(out).toEqual({ ok: true, name: "Cafe" });
    expect(mockGen).toHaveBeenCalledTimes(2);
    // the retry appends a corrective instruction to the prompt, naming the paths
    const secondCall = mockGen.mock.calls[1]?.[0] as { prompt: string };
    expect(secondCall.prompt).toContain("did not match the required schema");
    expect(secondCall.prompt).toContain("ok");
  });

  it("throws LlmError(kind:'schema') after the retry also fails", async () => {
    mockGen.mockRejectedValue(schemaRejection({ ok: "still-bad" }));

    const provider = new AnthropicProvider({ apiKey: API_KEY });
    const err = await provider
      .completeStructured({ system: "sys", user: USER_PROMPT, schema })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(LlmError);
    expect((err as LlmError).kind).toBe("schema");
    expect(mockGen).toHaveBeenCalledTimes(2);
    // message names the failing path, never the payload or the model's text
    expect((err as LlmError).message).toContain("ok");
    expect((err as LlmError).message).not.toContain(USER_PROMPT);
    expect((err as LlmError).message).not.toContain("still-bad");
    expect((err as LlmError).cause).toBeUndefined();
  });

  it("treats an unparseable response as a schema failure too (retry, then schema error)", async () => {
    mockGen.mockRejectedValue(unparseableRejection("Sure! Here is the JSON:"));

    const provider = new AnthropicProvider({ apiKey: API_KEY });
    const err = await provider
      .completeStructured({ system: "sys", user: USER_PROMPT, schema })
      .catch((e: unknown) => e);

    expect((err as LlmError).kind).toBe("schema");
    expect(mockGen).toHaveBeenCalledTimes(2);
  });

  it("still re-validates a resolved object (belt and braces if the SDK ever stops)", async () => {
    mockGen.mockResolvedValue(genResult({ ok: "not-a-bool" }));

    const provider = new AnthropicProvider({ apiKey: API_KEY });
    const err = await provider
      .completeStructured({ system: "sys", user: USER_PROMPT, schema })
      .catch((e: unknown) => e);

    expect((err as LlmError).kind).toBe("schema");
    expect(mockGen).toHaveBeenCalledTimes(2);
  });

  it("maps an aborted in-flight call to LlmError(kind:'abort') and does not retry", async () => {
    mockGen.mockRejectedValueOnce(
      Object.assign(new Error("The operation was aborted"), {
        name: "AbortError",
      }),
    );
    const provider = new AnthropicProvider({ apiKey: API_KEY });
    const err = await provider
      .completeStructured({ system: "s", user: "u", schema })
      .catch((e: unknown) => e);
    expect((err as LlmError).kind).toBe("abort");
    expect(mockGen).toHaveBeenCalledTimes(1);
  });

  it("does not call the SDK when the signal is already aborted", async () => {
    const provider = new AnthropicProvider({ apiKey: API_KEY });
    const err = await provider
      .completeStructured({
        system: "s",
        user: "u",
        schema,
        signal: AbortSignal.abort(),
      })
      .catch((e: unknown) => e);
    expect((err as LlmError).kind).toBe("abort");
    expect(mockGen).not.toHaveBeenCalled();
  });

  it("maps auth failures and generic failures to the right kind, without retrying", async () => {
    mockGen.mockRejectedValueOnce(new Error("HTTP 401 unauthorized: bad api-key"));
    const provider = new AnthropicProvider({ apiKey: API_KEY });
    const authErr = await provider
      .completeStructured({ system: "s", user: "u", schema })
      .catch((e: unknown) => e);
    expect((authErr as LlmError).kind).toBe("auth");
    // the raw SDK message (which could embed request context) is not echoed
    expect((authErr as LlmError).message).not.toContain("api-key");
    expect(mockGen).toHaveBeenCalledTimes(1);

    mockGen.mockReset();
    mockGen.mockRejectedValueOnce(new Error("socket hang up"));
    const netErr = await provider
      .completeStructured({ system: "s", user: "u", schema })
      .catch((e: unknown) => e);
    expect((netErr as LlmError).kind).toBe("network");
    expect(mockGen).toHaveBeenCalledTimes(1);
  });

  it("never logs the api key, the user prompt or the rejected model output", async () => {
    mockGen.mockRejectedValueOnce(schemaRejection({ ok: "bad-model-output" }));
    mockGen.mockResolvedValueOnce(genResult({ ok: true, name: "X" }));

    const events: LlmLogEvent[] = [];
    const provider = new AnthropicProvider({
      apiKey: API_KEY,
      logger: (e) => events.push(e),
    });
    await provider.completeStructured({
      system: "sys",
      user: USER_PROMPT,
      schema,
    });

    expect(events.length).toBeGreaterThan(0);
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain(API_KEY);
    expect(serialized).not.toContain(USER_PROMPT);
    expect(serialized).not.toContain("scraped review text");
    expect(serialized).not.toContain("bad-model-output");
    // it does log the useful non-secret facts
    expect(serialized).toContain(DEFAULT_ANTHROPIC_MODEL);
    expect(events.some((e) => e.event === "llm_retry")).toBe(true);
    expect(events.some((e) => e.event === "llm_call")).toBe(true);
  });

  it("rejects an empty api key at construction", () => {
    expect(() => new AnthropicProvider({ apiKey: "  " })).toThrow(LlmError);
  });
});
