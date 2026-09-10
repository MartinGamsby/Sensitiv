import { describe, expect, it } from "vitest";
import * as shared from "@sensitiv/shared";

// Smoke test: proves the pnpm workspace resolves @sensitiv/shared and that the
// package "exports" map points at the TypeScript source (no build step).
describe("@sensitiv/shared", () => {
  it("resolves through the workspace exports map", () => {
    expect(typeof shared).toBe("object");
  });

  it("is an empty barrel until Section 2 lands", () => {
    expect(Object.keys(shared)).toHaveLength(0);
  });
});
