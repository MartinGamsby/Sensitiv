import { describe, expect, it } from "vitest";
import * as shared from "@sensitiv/shared";

// Smoke test: proves the pnpm workspace resolves @sensitiv/shared and that the
// package "exports" map points at the TypeScript source (no build step).
describe("@sensitiv/shared", () => {
  it("resolves through the workspace exports map", () => {
    expect(typeof shared).toBe("object");
  });

  it("re-exports the Section 2 domain schemas and helpers", () => {
    expect(typeof shared.LocationSchema).toBe("object");
    expect(typeof shared.resolveSearchLanguage).toBe("function");
    expect(typeof shared.disclaimerFor).toBe("function");
    expect(typeof shared.JobCreateInputStrictSchema).toBe("object");
  });
});
