import { AnthropicProvider } from "./anthropic.ts";
import { FakeLlmProvider } from "./fake.ts";
import { OpenAiProvider } from "./openai.ts";
import type { LlmLogger, LlmProvider } from "./types.ts";

export const LLM_PROVIDER_NAMES = ["anthropic", "openai", "fake"] as const;
export type LlmProviderName = (typeof LLM_PROVIDER_NAMES)[number];

/** Just the env fields the factory reads — keeps it decoupled from `env.ts`. */
export type LlmFactoryEnv = {
  LLM_PROVIDER?: string;
  ANTHROPIC_API_KEY?: string;
};

export type LlmFactoryDeps = {
  /** Called once with the fallback notice when a key is missing. */
  warn?: (message: string) => void;
  /** Passed to the real provider for secret-free call logging. */
  logger?: LlmLogger;
};

export const FAKE_FALLBACK_WARNING =
  "ANTHROPIC_API_KEY not set — using the fake LLM provider; results are canned.";

/**
 * Pick the provider from `LLM_PROVIDER`. The `anthropic`-without-a-key branch is
 * what lets the whole app boot and run with an empty `.env`.
 */
export function createLlmProvider(
  env: LlmFactoryEnv,
  deps: LlmFactoryDeps = {},
): LlmProvider {
  const warn = deps.warn ?? ((message: string) => console.warn(message));
  const provider = (env.LLM_PROVIDER ?? "anthropic").trim().toLowerCase();
  const apiKey = env.ANTHROPIC_API_KEY?.trim();

  switch (provider) {
    case "anthropic": {
      if (apiKey) {
        return new AnthropicProvider({ apiKey, logger: deps.logger });
      }
      warn(FAKE_FALLBACK_WARNING);
      return new FakeLlmProvider();
    }
    case "openai":
      return new OpenAiProvider();
    case "fake":
      return new FakeLlmProvider();
    default:
      throw new Error(
        `Unknown LLM_PROVIDER ${JSON.stringify(env.LLM_PROVIDER)}. ` +
          `Valid values: ${LLM_PROVIDER_NAMES.join(", ")}.`,
      );
  }
}
