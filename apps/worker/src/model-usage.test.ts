import { describe, expect, it } from "vitest";
import { createModelUsage } from "./model-usage.ts";

const call = (durationMs: number, outputTokens: number, reasoningTokens?: number) => ({
  event: "llm_call" as const,
  provider: "anthropic",
  model: "m",
  durationMs,
  inputTokens: 3_000,
  outputTokens,
  reasoningTokens,
});

describe("createModelUsage", () => {
  it("says nothing for a run that never called the model", () => {
    expect(createModelUsage().describe()).toBeUndefined();
  });

  it("sums the calls, and says how much of the output was thinking", () => {
    const usage = createModelUsage();
    usage.record(call(12_400, 2_450, 700));
    usage.record(call(6_900, 700));

    expect(usage.describe()).toBe(
      "model: 2 call(s), 19.3s summed across them — 6,000 tokens in, 3,150 out (700 of them thinking)",
    );
  });

  it("names retries and failures only when there were some", () => {
    const usage = createModelUsage();
    usage.record(call(1_000, 100));
    usage.record({ event: "llm_retry", provider: "anthropic", model: "m", issues: ["places"] });
    usage.record({ event: "llm_error", provider: "anthropic", model: "m", kind: "schema" });

    expect(usage.describe()).toMatch(/; 1 retried, 1 failed$/);
  });
});
