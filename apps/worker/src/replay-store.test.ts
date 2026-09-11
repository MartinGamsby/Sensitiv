// Real disk I/O against the actual repo root — `findRepoRoot()` is not
// injectable (by design: both the worker and the Next server resolve it the
// same way, from `pnpm-workspace.yaml`), so this writes under the real
// `data/replays/` (gitignored) and cleans up afterward.
import { readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findRepoRoot } from "@sensitiv/db";
import type { ReplayBytes } from "./browser/solari.ts";
import { REPLAY_MAX_BYTES, resolveStoredReplay, storeReplay } from "./replay-store.ts";

const jobId = `replay-store-test-job-${Date.now()}`;

afterEach(async () => {
  await rm(resolve(findRepoRoot(), "data", "replays", jobId), {
    recursive: true,
    force: true,
  });
});

describe("storeReplay", () => {
  it("writes gzipped bytes under data/replays/<jobId>/ with a .ndjson.gz extension", async () => {
    const replay: ReplayBytes = {
      bytes: new Uint8Array([0x1f, 0x8b, 1, 2, 3]),
      gzipped: true,
    };
    const stored = await storeReplay(jobId, "sess-abc-123", replay);

    expect(stored.contentType).toBe("application/gzip");
    expect(stored.sizeBytes).toBe(5);
    expect(stored.relativePath).toBe(`data/replays/${jobId}/sess-abc-123.ndjson.gz`);
    // Forward slashes even though this is a Windows host.
    expect(stored.relativePath).not.toContain("\\");

    const abs = resolve(findRepoRoot(), stored.relativePath);
    const onDisk = await readFile(abs);
    expect(Array.from(onDisk)).toEqual([0x1f, 0x8b, 1, 2, 3]);
  });

  it("writes plain NDJSON with a .ndjson extension when not gzipped", async () => {
    const replay: ReplayBytes = {
      bytes: new TextEncoder().encode('{"type":"nav"}\n'),
      gzipped: false,
    };
    const stored = await storeReplay(jobId, "sess-plain", replay);

    expect(stored.contentType).toBe("application/x-ndjson");
    expect(stored.relativePath).toBe(`data/replays/${jobId}/sess-plain.ndjson`);
  });

  it("sanitizes a session id down to alnum + dash, falling back to a UUID if nothing survives", async () => {
    const replay: ReplayBytes = { bytes: new Uint8Array([1]), gzipped: false };
    const stored = await storeReplay(jobId, "///", replay);

    // Nothing alnum/dash survived "///" — a fresh UUID stands in.
    expect(stored.relativePath).toMatch(
      new RegExp(`^data/replays/${jobId}/[0-9a-f-]{36}\\.ndjson$`),
    );
  });
});

describe("resolveStoredReplay", () => {
  it("resolves a repo-relative path under data/replays to an absolute one", async () => {
    const replay: ReplayBytes = { bytes: new Uint8Array([1]), gzipped: false };
    const stored = await storeReplay(jobId, "sess-resolve", replay);

    const abs = resolveStoredReplay(stored.relativePath);
    expect(abs).toBe(resolve(findRepoRoot(), stored.relativePath));
  });

  it("refuses a path that resolves outside data/replays", () => {
    expect(resolveStoredReplay("../outside.ndjson")).toBeUndefined();
    expect(resolveStoredReplay("data/replays/../../secrets.txt")).toBeUndefined();
  });
});

describe("REPLAY_MAX_BYTES", () => {
  it("is a generous but bounded cap", () => {
    expect(REPLAY_MAX_BYTES).toBe(25 * 1024 * 1024);
  });
});
