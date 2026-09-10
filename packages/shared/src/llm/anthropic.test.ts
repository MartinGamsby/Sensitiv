import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { generateObject } from "ai";
import { AnthropicProvider, DEFAULT_ANTHROPIC_MODEL } from "./anthropic.ts";
import { LlmError, type LlmLogEvent } from "./types.ts";

vi.mock("ai", () => ({ generateObject: vi.fn() }));
vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: () => (modelId: string) => ({ modelId }),
}));

const mockGen = vi.mocked(generateObject);

const schema = z.object({ ok: z.boolean(), name: z.string().min(1) });
const API_KEY = "sk-ant-super-secret-test-key";
const USER_PROMPT = "SECRET USER PAYLOAD: scraped review text here";

type GenResult = Awaited<ReturnType<typeof generateObject>>;
function genResult(object: unknown): GenResult {
  return {
    object,
    usage: { promptTokens: 12, completionTokens: 7, totalTokens: 19 },
  } as unknown as GenResult;
}

beforeEach(() => {
  mockGen.mockReset();
});

describe("AnthropicProvider.completeStructured", () => {
  it("retries once on a schema-invalid response, then returns the valid one", async () => {
    mockGen.mockResolvedValueOnce(genResult({ ok: "not-a-bool" }));
    mockGen.mockResolvedValueOnce(genResult({ ok: true, name: "Cafe" }));

    const provider = new AnthropicProvider({ apiKey: API_KEY });
    const out = await provider.completeStructured({
      system: "sys",
      user: USER_PROMPT,
      schema,
    });

    expect(out).toEqual({ ok: true, name: "Cafe" });
    expect(mockGen).toHaveBeenCalledTimes(2);
    // the retry appends a corrective instruction to the prompt
    const secondCall = mockGen.mock.calls[1]?.[0] as { prompt: string };
    expect(secondCall.prompt).toContain("did not match the required schema");
  });

  it("throws LlmError(kind:'schema') after the retry also fails", async () => {
    mockGen.mockResolvedValue(genResult({ ok: "still-bad" }));

    const provider = new AnthropicProvider({ apiKey: API_KEY });
    const err = await provider
      .completeStructured({ system: "sys", user: USER_PROMPT, schema })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(LlmError);
    expect((err as LlmError).kind).toBe("schema");
    expect(mockGen).toHaveBeenCalledTimes(2);
    // message names the failing path, never the payload
    expect((err as LlmError).message).toContain("ok");
    expect((err as LlmError).message).not.toContain(USER_PROMPT);
  });

  it("maps an aborted in-flight call to LlmError(kind:'abort')", async () => {
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

  it("maps auth failures and generic failures to the right kind", async () => {
    mockGen.mockRejectedValueOnce(new Error("HTTP 401 unauthorized: bad api-key"));
    const provider = new AnthropicProvider({ apiKey: API_KEY });
    const authErr = await provider
      .completeStructured({ system: "s", user: "u", schema })
      .catch((e: unknown) => e);
    expect((authErr as LlmError).kind).toBe("auth");
    // the raw SDK message (which could embed request context) is not echoed
    expect((authErr as LlmError).message).not.toContain("api-key");

    mockGen.mockRejectedValueOnce(new Error("socket hang up"));
    const netErr = await provider
      .completeStructured({ system: "s", user: "u", schema })
      .catch((e: unknown) => e);
    expect((netErr as LlmError).kind).toBe("network");
  });

  it("never logs the api key or the user prompt", async () => {
    mockGen.mockResolvedValueOnce(genResult({ ok: "bad" }));
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
    // it does log the useful non-secret facts
    expect(serialized).toContain(DEFAULT_ANTHROPIC_MODEL);
    expect(events.some((e) => e.event === "llm_call")).toBe(true);
  });

  it("rejects an empty api key at construction", () => {
    expect(() => new AnthropicProvider({ apiKey: "  " })).toThrow(LlmError);
  });
});
