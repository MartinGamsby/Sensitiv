// Real disk I/O against the actual repo root — `findRepoRoot()` is not
// injectable (by design: both the worker and the Next server resolve it the
// same way, from `pnpm-workspace.yaml`), so this writes under the real
// `data/replays/` (gitignored) and cleans up afterward.
import { access, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  addReplay,
  findRepoRoot,
  getDossier,
  resolveStoredReplayPath,
} from "@sensitiv/db";
import type { ReplayBytes } from "./browser/solari.ts";
import {
  REPLAY_MAX_BYTES,
  pruneStoredReplays,
  storeReplay,
} from "./replay-store.ts";
import { makeDb, seedJob } from "../test/helpers.ts";

const jobId = `replay-store-test-job-${Date.now()}`;
/** Every job directory this file writes to, so nothing is left behind. */
const writtenJobIds: string[] = [jobId];

afterEach(async () => {
  for (const id of writtenJobIds) {
    await rm(resolve(findRepoRoot(), "data", "replays", id), {
      recursive: true,
      force: true,
    });
  }
  writtenJobIds.length = 1;
});

const exists = async (absPath: string): Promise<boolean> => {
  try {
    await access(absPath);
    return true;
  } catch {
    return false;
  }
};

const DAY_MS = 24 * 60 * 60 * 1000;

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

describe("storeReplay + resolveStoredReplayPath", () => {
  it("writes a path the shared resolver accepts and resolves back to the same file", async () => {
    const replay: ReplayBytes = { bytes: new Uint8Array([1]), gzipped: false };
    const stored = await storeReplay(jobId, "sess-resolve", replay);

    // The containment check itself is unit-tested in
    // `packages/db/src/client.test.ts` — this asserts the writer and that one
    // resolver agree on the same path, which is the seam that could drift.
    expect(resolveStoredReplayPath(stored.relativePath)).toBe(
      resolve(findRepoRoot(), stored.relativePath),
    );
  });
});

describe("REPLAY_MAX_BYTES", () => {
  it("is a generous but bounded cap", () => {
    expect(REPLAY_MAX_BYTES).toBe(25 * 1024 * 1024);
  });
});

describe("pruneStoredReplays", () => {
  /** A job with one stored replay on disk, aged by rewinding the clock we
   *  measure against rather than by touching `created_at`. */
  async function seedStoredReplay() {
    const handle = await makeDb();
    const job = await seedJob(handle.db);
    writtenJobIds.push(job.id);
    const stored = await storeReplay(job.id, "sess-prune", {
      bytes: new TextEncoder().encode('{"type":"nav"}\n'),
      gzipped: false,
    });
    const { id } = await addReplay(handle.db, job.id, {
      solariSessionId: "sess-prune",
      adapterId: "google_maps",
      findingCount: 7,
      status: "stored",
      storedPath: stored.relativePath,
      sizeBytes: stored.sizeBytes,
      contentType: stored.contentType,
    });
    const abs = resolve(findRepoRoot(), stored.relativePath);
    return { handle, job, replayId: id, abs };
  }

  it("keeps everything FOREVER when the retention is 0 — the dev setting", async () => {
    const { handle, abs } = await seedStoredReplay();
    try {
      const result = await pruneStoredReplays({
        db: handle.db,
        retentionDays: 0,
        // A year on, and still untouched.
        now: Date.now() + 365 * DAY_MS,
      });
      expect(result.removed).toBe(0);
      expect(await exists(abs)).toBe(true);
    } finally {
      handle.client.close();
    }
  });

  it("leaves a replay younger than the retention alone", async () => {
    const { handle, abs } = await seedStoredReplay();
    try {
      const result = await pruneStoredReplays({ db: handle.db, retentionDays: 30 });
      expect(result.removed).toBe(0);
      expect(await exists(abs)).toBe(true);
    } finally {
      handle.client.close();
    }
  });

  it("deletes the bytes of an older replay but KEEPS the row, as expired", async () => {
    const { handle, job, abs } = await seedStoredReplay();
    try {
      const result = await pruneStoredReplays({
        db: handle.db,
        retentionDays: 7,
        now: Date.now() + 8 * DAY_MS,
      });
      expect(result.removed).toBe(1);
      expect(result.freedBytes).toBeGreaterThan(0);
      expect(await exists(abs)).toBe(false);

      // The row survives, because it is what lets a finished dossier still say
      // WHICH source recorded and how many findings it contributed. Deleting it
      // would silently rewrite the history of that run.
      const dossier = await getDossier(handle.db, job.id, job.userId);
      expect(dossier?.replays).toHaveLength(1);
      const replay = dossier?.replays[0];
      expect(replay?.adapterId).toBe("google_maps");
      expect(replay?.findingCount).toBe(7);
      // `expired`, NOT `unavailable`: "we deleted this after N days" and "there
      // was never anything here" are different facts.
      expect(replay?.status).toBe("expired");
      expect(replay?.sizeBytes).toBeUndefined();
      expect(replay?.url).toBeUndefined();
    } finally {
      handle.client.close();
    }
  });

  it("refuses to delete a stored_path pointing outside data/replays/", async () => {
    // `stored_path` is a DB value, and a sweep that unlinked whatever it found
    // there would be a delete primitive pointed at an untrusted string. The row
    // is still cleared, so the bad value stops being referenced.
    const handle = await makeDb();
    const job = await seedJob(handle.db);
    try {
      await addReplay(handle.db, job.id, {
        solariSessionId: "sess-escape",
        status: "stored",
        storedPath: "../../etc/passwd",
        sizeBytes: 1,
      });
      const warnings: string[] = [];
      const result = await pruneStoredReplays({
        db: handle.db,
        retentionDays: 1,
        now: Date.now() + 2 * DAY_MS,
        log: (m) => warnings.push(m),
      });
      expect(result.removed).toBe(1);
      expect(result.freedBytes).toBe(0);
      expect(warnings.join(" ")).toMatch(/outside data\/replays/i);

      const dossier = await getDossier(handle.db, job.id, job.userId);
      expect(dossier?.replays[0]?.status).toBe("expired");
    } finally {
      handle.client.close();
    }
  });

  it("never touches a replay that was never stored", async () => {
    const handle = await makeDb();
    const job = await seedJob(handle.db);
    try {
      await addReplay(handle.db, job.id, {
        solariSessionId: "sess-linkonly",
        status: "link_only",
        replayUrl: "https://replay.example/x",
      });
      const result = await pruneStoredReplays({
        db: handle.db,
        retentionDays: 1,
        now: Date.now() + 400 * DAY_MS,
      });
      expect(result.removed).toBe(0);
      const dossier = await getDossier(handle.db, job.id, job.userId);
      expect(dossier?.replays[0]?.status).toBe("link_only");
    } finally {
      handle.client.close();
    }
  });
});
