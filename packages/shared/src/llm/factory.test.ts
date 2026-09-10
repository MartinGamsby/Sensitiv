import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AnthropicProvider } from "./anthropic.ts";
import { FakeLlmProvider } from "./fake.ts";
import { OpenAiProvider } from "./openai.ts";
import { createLlmProvider, FAKE_FALLBACK_WARNING } from "./factory.ts";
import { LlmError } from "./types.ts";

describe("createLlmProvider", () => {
  it("falls back to the fake provider (warning once) when anthropic has no key", () => {
    const warn = vi.fn();
    const provider = createLlmProvider({ LLM_PROVIDER: "anthropic" }, { warn });
    expect(provider).toBeInstanceOf(FakeLlmProvider);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(FAKE_FALLBACK_WARNING);
  });

  it("defaults LLM_PROVIDER to anthropic when unset (empty .env)", () => {
    const warn = vi.fn();
    const provider = createLlmProvider({}, { warn });
    expect(provider).toBeInstanceOf(FakeLlmProvider);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("returns a real AnthropicProvider when the key is present, no warning", () => {
    const warn = vi.fn();
    const provider = createLlmProvider(
      { LLM_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "sk-ant-xxx" },
      { warn },
    );
    expect(provider).toBeInstanceOf(AnthropicProvider);
    expect(warn).not.toHaveBeenCalled();
  });

  it("treats a whitespace-only key as absent", () => {
    const provider = createLlmProvider(
      { LLM_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "   " },
      { warn: vi.fn() },
    );
    expect(provider).toBeInstanceOf(FakeLlmProvider);
  });

  it("returns an OpenAiProvider stub whose call throws 'not wired in v1'", async () => {
    const provider = createLlmProvider({ LLM_PROVIDER: "openai" });
    expect(provider).toBeInstanceOf(OpenAiProvider);
    const err = await provider
      .completeStructured({ system: "s", user: "u", schema: z.object({}) })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LlmError);
    expect((err as LlmError).message).toContain("not wired in v1");
  });

  it("returns the fake provider directly for LLM_PROVIDER=fake", () => {
    const provider = createLlmProvider({ LLM_PROVIDER: "fake" });
    expect(provider).toBeInstanceOf(FakeLlmProvider);
  });

  it("throws naming the valid values on an unknown LLM_PROVIDER", () => {
    expect(() => createLlmProvider({ LLM_PROVIDER: "bogus" })).toThrow(
      /anthropic, openai, fake/,
    );
  });
});
