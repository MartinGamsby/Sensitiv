// A run's model bill, tallied from the provider's own call records.
//
// The per-query and per-place timing lines say how long a run waited on the
// model. They could not say what it was doing in that time: a batch of eight
// result cards once spent ~700 of its ~2,450 output tokens thinking, at an
// effort nobody had chosen, and no log line showed it.
import type { LlmLogEvent } from "@sensitiv/shared/llm";

export interface ModelUsage {
  /** Pass as the provider's `logger`. */
  record: (event: LlmLogEvent) => void;
  /** One line for the job log, or `undefined` when no call was made. */
  describe: () => string | undefined;
}

export function createModelUsage(): ModelUsage {
  let calls = 0;
  let retries = 0;
  let failures = 0;
  let ms = 0;
  let input = 0;
  let output = 0;
  let thinking = 0;

  return {
    record: (event) => {
      if (event.event === "llm_call") {
        calls += 1;
        ms += event.durationMs;
        input += event.inputTokens ?? 0;
        output += event.outputTokens ?? 0;
        thinking += event.reasoningTokens ?? 0;
      } else if (event.event === "llm_retry") {
        retries += 1;
      } else {
        failures += 1;
      }
    },
    describe: () => {
      if (calls === 0 && failures === 0) return undefined;
      const n = (value: number): string => value.toLocaleString("en-US");
      const trouble = [
        retries > 0 ? `${retries} retried` : "",
        failures > 0 ? `${failures} failed` : "",
      ].filter(Boolean);
      return (
        `model: ${calls} call(s), ${(ms / 1000).toFixed(1)}s summed across them — ` +
        `${n(input)} tokens in, ${n(output)} out (${n(thinking)} of them thinking)` +
        (trouble.length > 0 ? `; ${trouble.join(", ")}` : "")
      );
    },
  };
}
