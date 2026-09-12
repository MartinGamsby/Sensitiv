import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  findRepoRoot,
  replaysRoot,
  resolveDatabaseUrl,
  resolveStoredReplayPath,
} from "./client.ts";

describe("findRepoRoot", () => {
  it("resolves to the same root from different cwds (web vs worker)", () => {
    const root = findRepoRoot();
    const fromWeb = findRepoRoot(join(root, "apps", "web"));
    const fromWorker = findRepoRoot(join(root, "apps", "worker"));
    expect(fromWeb).toBe(root);
    expect(fromWorker).toBe(root);
  });
});

describe("resolveStoredReplayPath", () => {
  const root = findRepoRoot();

  it("resolves a repo-relative path under data/replays to an absolute one", () => {
    const rel = "data/replays/job-1/sess-1.ndjson.gz";
    expect(resolveStoredReplayPath(rel)).toBe(resolve(root, rel));
  });

  it("accepts the replay root itself", () => {
    expect(resolveStoredReplayPath("data/replays")).toBe(replaysRoot(root));
  });

  it("refuses anything that resolves outside data/replays", () => {
    expect(resolveStoredReplayPath("../outside.ndjson")).toBeUndefined();
    expect(resolveStoredReplayPath("data/replays/../../secrets.txt")).toBeUndefined();
    expect(resolveStoredReplayPath("data/sensitiv.db")).toBeUndefined();
    // A sibling directory that merely shares the prefix must not pass.
    expect(resolveStoredReplayPath("data/replays-evil/x.ndjson")).toBeUndefined();
    // An absolute path wins over the repo root in `resolve()` — still refused.
    expect(resolveStoredReplayPath(resolve(root, "package.json"))).toBeUndefined();
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
