import { createAnthropic } from "@ai-sdk/anthropic";
import { generateObject } from "ai";
import { LlmError, noopLogger } from "./types.ts";
import type { LlmLogger, LlmProvider, StructuredArgs } from "./types.ts";

/**
 * The single place a Claude model id lives. Model ids go stale — update this one
 * constant, never scatter model strings through the codebase.
 * `claude-sonnet-5` is the current Claude Sonnet id.
 */
export const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-5";

export type AnthropicProviderOptions = {
  /** Held only in memory on this instance. Never logged, never persisted. */
  apiKey: string;
  model?: string;
  logger?: LlmLogger;
};

export class AnthropicProvider implements LlmProvider {
  readonly name = "anthropic";
  readonly #model: string;
  readonly #logger: LlmLogger;
  readonly #anthropic: ReturnType<typeof createAnthropic>;

  constructor(opts: AnthropicProviderOptions) {
    if (!opts.apiKey || opts.apiKey.trim() === "") {
      throw new LlmError(
        "AnthropicProvider requires an API key",
        undefined,
        "auth",
      );
    }
    this.#model = opts.model ?? DEFAULT_ANTHROPIC_MODEL;
    this.#logger = opts.logger ?? noopLogger;
    this.#anthropic = createAnthropic({ apiKey: opts.apiKey });
  }

  async completeStructured<T>(args: StructuredArgs<T>): Promise<T> {
    const {
      system,
      user,
      schema,
      maxTokens = 4096,
      temperature = 0,
      signal,
    } = args;
    const model = this.#anthropic(this.#model);

    // Retry policy (locked by plan): one retry on a schema-validation failure,
    // then throw. Network/auth/abort errors are not retried.
    let issues: string[] = [];
    for (let attempt = 0; attempt < 2; attempt++) {
      if (signal?.aborted) {
        this.#logger({
          event: "llm_error",
          provider: this.name,
          model: this.#model,
          kind: "abort",
        });
        throw new LlmError("LLM call aborted", undefined, "abort");
      }

      const prompt =
        attempt === 0 ? user : `${user}\n\n${correctionMessage(issues)}`;
      const startedAt = Date.now();

      let raw: unknown;
      try {
        const result = await generateObject({
          model,
          schema,
          system,
          prompt,
          maxTokens,
          temperature,
          abortSignal: signal,
        });
        raw = result.object;
        this.#logger({
          event: "llm_call",
          provider: this.name,
          model: this.#model,
          durationMs: Date.now() - startedAt,
          inputTokens: result.usage?.promptTokens,
          outputTokens: result.usage?.completionTokens,
        });
      } catch (err) {
        throw this.#mapError(err);
      }

      const parsed = schema.safeParse(raw);
      if (parsed.success) return parsed.data;

      issues = issuePaths(parsed.error.issues);
      this.#logger({
        event: "llm_retry",
        provider: this.name,
        model: this.#model,
        issues,
      });
    }

    this.#logger({
      event: "llm_error",
      provider: this.name,
      model: this.#model,
      kind: "schema",
      issues,
    });
    throw new LlmError(
      `LLM response failed schema validation after one retry (paths: ${
        issues.join(", ") || "unknown"
      })`,
      undefined,
      "schema",
    );
  }

  #mapError(err: unknown): LlmError {
    if (err instanceof LlmError) return err;
    const name = err instanceof Error ? err.name : "";
    const message = err instanceof Error ? err.message : String(err);

    if (name === "AbortError" || /\babort(ed)?\b/i.test(message)) {
      return new LlmError("LLM call aborted", err, "abort");
    }
    if (/api[\s-]?key|unauthor|forbidden|\b401\b|\b403\b/i.test(message)) {
      // Do not echo `message` — an SDK error can embed request context.
      return new LlmError("LLM authentication failed", err, "auth");
    }
    return new LlmError("LLM request failed", err, "network");
  }
}

function issuePaths(issues: readonly { path: (string | number)[] }[]): string[] {
  return issues.map((issue) => issue.path.join(".") || "(root)");
}

function correctionMessage(issues: string[]): string {
  return (
    `Your previous response did not match the required schema: ${
      issues.join(", ") || "unknown"
    }. ` + "Return only valid JSON matching the schema."
  );
}
