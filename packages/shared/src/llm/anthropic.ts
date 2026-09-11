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

/** One initial call plus one corrective retry, then throw. Locked by plan. */
const MAX_ATTEMPTS = 2;

/**
 * `err.name` values the `ai` SDK uses for "the model's output did not satisfy
 * the schema". Matched by name rather than `instanceof` so a duplicated /
 * hoisted copy of `@ai-sdk/provider` in the pnpm store still maps correctly.
 * The un-prefixed spellings are accepted for forward compatibility.
 */
const SCHEMA_ERROR_NAMES = new Set([
  "AI_NoObjectGeneratedError",
  "NoObjectGeneratedError",
  "AI_TypeValidationError",
  "TypeValidationError",
  "AI_JSONParseError",
  "JSONParseError",
]);
const MAX_CAUSE_DEPTH = 5;

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
    const { system, user, schema, maxTokens = 4096, signal } = args;
    const model = this.#anthropic(this.#model);
    // `claude-sonnet-5` (the current DEFAULT_ANTHROPIC_MODEL) rejects
    // `temperature` outright — the API returns 400 "`temperature` is
    // deprecated for this model", which every single call hit before this
    // fix (surfacing as a misleading `kind: "network"` LlmError, since the
    // message doesn't match the auth regex either). Verified live against
    // the real API. `StructuredArgs.temperature` is intentionally ignored
    // here rather than removed from the type: a future/other model may
    // accept it again, and other providers (OpenAI) still can.

    // Retry policy (locked by plan): one retry on a schema-validation failure,
    // then throw. Network/auth/abort errors are not retried.
    //
    // How a schema miss actually surfaces (verified against ai@4.3.19,
    // @ai-sdk/provider@1.1.3): `generateObject` parses the model's text and
    // validates it against the very `schema` passed here, and THROWS
    // `NoObjectGeneratedError` (name "AI_NoObjectGeneratedError", `cause` an
    // "AI_TypeValidationError" wrapping the ZodError, or an "AI_JSONParseError"
    // when the text is not JSON at all). It never resolves with an object that
    // failed validation. So the retry has to live around the SDK call, in the
    // `catch` — a `safeParse` of the resolved object can only ever be a
    // belt-and-braces re-check, never the thing that detects the miss.
    let issues: string[] = [];
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      if (signal?.aborted) {
        this.#logger({
          event: "llm_error",
          provider: this.name,
          model: this.#model,
          kind: "abort",
        });
        throw new LlmError("LLM call aborted", undefined, "abort");
      }

      const lastAttempt = attempt === MAX_ATTEMPTS - 1;
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
          abortSignal: signal,
        });
        raw = result.object;
        this.#logger({
          event: "llm_call",
          provider: this.name,
          model: this.#model,
          durationMs: Date.now() - startedAt,
          inputTokens: result.usage?.inputTokens,
          outputTokens: result.usage?.outputTokens,
        });
      } catch (err) {
        const failed = schemaFailureIssues(err);
        // Not a schema failure -> network / auth / abort. Never retried.
        if (!failed) throw this.#mapError(err);
        issues = failed;
        if (lastAttempt) break;
        this.#logger({
          event: "llm_retry",
          provider: this.name,
          model: this.#model,
          issues,
        });
        continue;
      }

      // Belt and braces: the SDK has already validated `raw` against this exact
      // schema, so this fires only if that ever stops being true.
      const parsed = schema.safeParse(raw);
      if (parsed.success) return parsed.data;

      issues = issuePaths(parsed.error.issues);
      if (lastAttempt) break;
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
    // No `cause`: the SDK's schema errors carry the raw model text and the
    // rejected value, and this error is stringified into job_events.
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

/**
 * `undefined` when `err` is not a schema failure (so the caller re-throws it as
 * network / auth / abort); otherwise the failing zod paths, `[]` when the SDK
 * could not even parse the response as JSON so there are no paths to name.
 *
 * Walks the `cause` chain because `generateObject` wraps: NoObjectGeneratedError
 * -> TypeValidationError -> ZodError. Only `path` is read out — never the
 * rejected value or the raw model text, both of which are untrusted content.
 */
function schemaFailureIssues(err: unknown): string[] | undefined {
  let isSchemaFailure = false;
  let paths: string[] | undefined;
  let node: unknown = err;

  for (let depth = 0; depth < MAX_CAUSE_DEPTH && node instanceof Error; depth++) {
    if (SCHEMA_ERROR_NAMES.has(node.name)) isSchemaFailure = true;
    const issues = (node as { issues?: unknown }).issues;
    if (!paths && Array.isArray(issues) && issues.every(hasPath)) {
      paths = issuePaths(issues);
    }
    node = (node as { cause?: unknown }).cause;
  }

  if (!isSchemaFailure) return undefined;
  return paths ?? [];
}

function hasPath(issue: unknown): issue is { path: (string | number)[] } {
  return (
    typeof issue === "object" &&
    issue !== null &&
    Array.isArray((issue as { path?: unknown }).path)
  );
}

function correctionMessage(issues: string[]): string {
  return (
    `Your previous response did not match the required schema: ${
      issues.join(", ") || "unknown"
    }. ` + "Return only valid JSON matching the schema."
  );
}
