import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findRepoRoot, resolveDatabaseUrl } from "./client.ts";

describe("findRepoRoot", () => {
  it("resolves to the same root from different cwds (web vs worker)", () => {
    const root = findRepoRoot();
    const fromWeb = findRepoRoot(join(root, "apps", "web"));
    const fromWorker = findRepoRoot(join(root, "apps", "worker"));
    expect(fromWeb).toBe(root);
    expect(fromWorker).toBe(root);
  });
});

describe("resolveDatabaseUrl", () => {
  it("resolves a relative file: path against the repo root, not cwd", () => {
    const a = resolveDatabaseUrl("file:./data/sensitiv.db", "/repo");
    const b = resolveDatabaseUrl("file:./data/sensitiv.db", "/somewhere/else");
    expect(a).not.toBe(b);
    // Same repo root => identical URL regardless of the process cwd.
    expect(resolveDatabaseUrl("file:./data/sensitiv.db", "/repo")).toBe(a);
  });

  it("passes :memory: and remote URLs through untouched", () => {
    expect(resolveDatabaseUrl(":memory:")).toBe(":memory:");
    expect(resolveDatabaseUrl("libsql://example.turso.io")).toBe(
      "libsql://example.turso.io",
    );
  });
});
