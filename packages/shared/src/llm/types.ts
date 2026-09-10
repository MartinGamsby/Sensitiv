// The one seam every LLM call in Sensitiv passes through. Swapping providers is
// a change to `factory.ts` and one env var — nothing else imports a concrete
// provider class.
import type { ZodType } from "zod";

export type StructuredArgs<T> = {
  /** Trusted instructions. Never contains scraped content. */
  system: string;
  /**
   * The user/content turn. MAY contain attacker-influenced scraped text — it is
   * always wrapped by `fenceUntrusted()` before it reaches here. Never logged.
   */
  user: string;
  /** The caller's contract. Every response is re-validated against it. */
  schema: ZodType<T>;
  /** Output token ceiling. Default 4096. */
  maxTokens?: number;
  /** Sampling temperature. Default 0 for reproducibility. */
  temperature?: number;
  /** The worker's job-timeout signal — a call must be cancellable. */
  signal?: AbortSignal;
};

export type LlmErrorKind = "schema" | "network" | "auth" | "abort";

/**
 * The only error type a provider throws.
 *
 * `message` must NEVER interpolate the API key or the raw `user` payload. It may
 * name the zod issue paths that failed — never the content at those paths.
 */
export class LlmError extends Error {
  override readonly name = "LlmError";
  readonly kind?: LlmErrorKind;

  constructor(message: string, cause?: unknown, kind?: LlmErrorKind) {
    super(message, cause === undefined ? undefined : { cause });
    this.kind = kind;
  }
}

export interface LlmProvider {
  readonly name: string;
  completeStructured<T>(args: StructuredArgs<T>): Promise<T>;
}

/**
 * Structured, secret-free log records. A provider emits only these — it never
 * logs the prompt, the response body, or the key.
 */
export type LlmLogEvent =
  | {
      event: "llm_call";
      provider: string;
      model: string;
      durationMs: number;
      inputTokens?: number;
      outputTokens?: number;
    }
  | { event: "llm_retry"; provider: string; model: string; issues: string[] }
  | {
      event: "llm_error";
      provider: string;
      model: string;
      kind: LlmErrorKind;
      issues?: string[];
    };

export type LlmLogger = (event: LlmLogEvent) => void;

/** Swallows every event. The default so tests and libraries stay quiet. */
export const noopLogger: LlmLogger = () => {};
