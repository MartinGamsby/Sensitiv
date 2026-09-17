import { describe, expect, it } from "vitest";
import {
  JobCreateInputStrictSchema,
  JobCreateInputSchema,
  DEFAULT_JOB_TIMEOUT_SEC,
} from "./job.ts";

const base = {
  location: { query: "Plateau-Mont-Royal, Montreal" },
  requestText: "gluten free brunch",
  chipIds: ["req_celiac"],
  uiLocale: "en" as const,
};

describe("JobCreateInputStrictSchema", () => {
  it("strips unknown keys", () => {
    const parsed = JobCreateInputStrictSchema.parse({
      ...base,
      somethingHostile: "drop me",
      __proto__polluter: 1,
    });
    expect(parsed).not.toHaveProperty("somethingHostile");
    expect(Object.keys(parsed).sort()).toEqual(
      [
        "chipIds",
        "location",
        "recordSession",
        "requestText",
        "timeoutSec",
        "uiLocale",
      ].sort(),
    );
  });

  it("defaults recordSession to false — recording is opt-in", () => {
    // The default is the privacy decision: a Solari recording is retained by a
    // third party and its captured URLs encode the user's requirements. A
    // client that never sends the field must not get a recording.
    expect(JobCreateInputStrictSchema.parse(base).recordSession).toBe(false);
    expect(
      JobCreateInputStrictSchema.parse({ ...base, recordSession: true })
        .recordSession,
    ).toBe(true);
  });

  it("defaults timeoutSec to 480", () => {
    expect(JobCreateInputStrictSchema.parse(base).timeoutSec).toBe(DEFAULT_JOB_TIMEOUT_SEC);
  });

  it("rejects an out-of-bounds timeout and accepts 480", () => {
    expect(() => JobCreateInputStrictSchema.parse({ ...base, timeoutSec: 30 })).toThrow();
    expect(() => JobCreateInputStrictSchema.parse({ ...base, timeoutSec: 5000 })).toThrow();
    expect(JobCreateInputStrictSchema.parse({ ...base, timeoutSec: 480 }).timeoutSec).toBe(480);
  });

  it("allows an empty chipIds array (free-text-only run)", () => {
    expect(JobCreateInputStrictSchema.parse({ ...base, chipIds: [] }).chipIds).toEqual([]);
  });

  it("normalizes the nested location (country casing)", () => {
    const parsed = JobCreateInputStrictSchema.parse({
      ...base,
      location: { query: "Paris", country: "fr" },
    });
    expect(parsed.location.country).toBe("FR");
  });
});

describe("JobCreateInputSchema (lenient)", () => {
  it("passes unknown keys through", () => {
    const parsed = JobCreateInputSchema.parse({ ...base, extra: "kept" });
    expect(parsed).toHaveProperty("extra", "kept");
  });
});
