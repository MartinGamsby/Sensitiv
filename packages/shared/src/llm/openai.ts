import { LlmError } from "./types.ts";
import type { LlmProvider, StructuredArgs } from "./types.ts";

export const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";

export type OpenAiProviderOptions = {
  apiKey?: string;
  model?: string;
};

/**
 * Stub. Exists so a later provider swap is `LLM_PROVIDER` + the factory and
 * nothing else. `completeStructured` throws until it is wired in v1.1.
 *
 * Sketch of the real implementation (do NOT add `@ai-sdk/openai` to
 * package.json until this is real — it mirrors AnthropicProvider exactly):
 *
 *   import { createOpenAI } from "@ai-sdk/openai";
 *   import { generateObject } from "ai";
 *
 *   const openai = createOpenAI({ apiKey: this.#apiKey });
 *   const { object } = await generateObject({
 *     model: openai(this.#model),
 *     schema: args.schema,
 *     system: args.system,
 *     prompt: args.user,
 *     maxTokens: args.maxTokens ?? 4096,
 *     temperature: args.temperature ?? 0,
 *     abortSignal: args.signal,
 *   });
 *   // same retry-once-then-throw loop + secret-free logging as AnthropicProvider
 *   return args.schema.parse(object);
 */
export class OpenAiProvider implements LlmProvider {
  readonly name = "openai";
  readonly #model: string;

  constructor(opts: OpenAiProviderOptions = {}) {
    this.#model = opts.model ?? DEFAULT_OPENAI_MODEL;
  }

  /** The model this stub would target once implemented. */
  get model(): string {
    return this.#model;
  }

  completeStructured<T>(_args: StructuredArgs<T>): Promise<T> {
    return Promise.reject(
      new LlmError("OpenAiProvider is not wired in v1", undefined, "network"),
    );
  }
}
