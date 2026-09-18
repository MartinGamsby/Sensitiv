// Where a captured replay lands on disk. `data/` is the one directory both
// the worker (cwd `apps/worker`) and the Next server (cwd `apps/web`) already
// agree on — the SQLite file lives there too, resolved the same way
// (`findRepoRoot()` in `packages/db/src/client.ts`). Replays go to
// `data/replays/<jobId>/<sessionId>.ndjson[.gz]`.
import { randomUUID } from "node:crypto";
import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import {
  findRepoRoot,
  listReplaysToPrune,
  markReplayExpired,
  replaysRoot,
  resolveStoredReplayPath,
  type DbHandle,
} from "@sensitiv/db";
import type { ReplayBytes } from "./browser/solari.ts";
import { describeError } from "./util.ts";

/** Third-party bytes at rest, on a local single-user app: 25 MB is generous
 *  for one recording and cheap to hold. */
export const REPLAY_MAX_BYTES = 25 * 1024 * 1024;

export interface StoredReplay {
  /** Repo-root-relative, forward slashes, for the `replays.stored_path` column. */
  relativePath: string;
  sizeBytes: number;
  contentType: "application/gzip" | "application/x-ndjson";
}

/** Same shape as `stickySessionId` in `browser/solari.ts` — these ids are
 *  ours (a Solari session id, a job's `randomUUID()`), but sanitizing before
 *  it becomes a path segment is cheap and closes the question outright. Falls
 *  back to a fresh `randomUUID()` when nothing survives. */
function sanitizeSegment(raw: string): string {
  return raw.replace(/[^A-Za-z0-9-]/g, "") || randomUUID();
}

/** Writes `replay.bytes` under `data/replays/<jobId>/<sessionId>.ndjson[.gz]`
 *  and returns the metadata `addReplay` needs. Never called for an empty or
 *  too-large buffer — the caller (`runner.ts`) decides that before storing. */
export async function storeReplay(
  jobId: string,
  sessionId: string,
  replay: ReplayBytes,
): Promise<StoredReplay> {
  const root = replaysRoot();
  const jobDir = sanitizeSegment(jobId);
  const fileStem = sanitizeSegment(sessionId);
  const filename = replay.gzipped ? `${fileStem}.ndjson.gz` : `${fileStem}.ndjson`;
  const absDir = resolve(root, jobDir);
  const absPath = resolve(absDir, filename);

  await mkdir(dirname(absPath), { recursive: true });
  await writeFile(absPath, replay.bytes);

  const relativePath = absPath
    .slice(resolve(findRepoRoot()).length + 1)
    .split(sep)
    .join("/");

  return {
    relativePath,
    sizeBytes: replay.bytes.byteLength,
    contentType: replay.gzipped ? "application/gzip" : "application/x-ndjson",
  };
}

// ---------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface PruneResult {
  /** Replays whose bytes were deleted and whose row is now `expired`. */
  removed: number;
  /** Bytes reclaimed, as recorded on the rows. */
  freedBytes: number;
}

/**
 * Delete stored replays older than `retentionDays`, keeping their rows.
 *
 * `retentionDays === 0` means KEEP FOREVER and returns immediately without
 * touching the disk. That is the dev setting, and it is the reason the env
 * value is `nonnegative` rather than `positive`: a stale recording is still
 * perfectly good for re-reading what the agent saw, and losing one to a sweep
 * mid-investigation is worse than the disk it costs.
 *
 * The ROW survives every prune. It is what lets a finished dossier still say
 * which source recorded and how many findings it contributed; deleting it
 * would silently rewrite the history of that run. The row's status becomes
 * `expired`, which the dossier renders differently from `unavailable` — "we
 * deleted this after N days" and "there was never anything here" are different
 * facts.
 *
 * Best-effort throughout: a file that will not delete must never stop a worker
 * from starting. Each failure is reported and the sweep carries on.
 */
export async function pruneStoredReplays(args: {
  db: DbHandle;
  retentionDays: number;
  now?: number;
  log?: (message: string) => void;
}): Promise<PruneResult> {
  const result: PruneResult = { removed: 0, freedBytes: 0 };
  if (args.retentionDays <= 0) return result;

  const cutoff = (args.now ?? Date.now()) - args.retentionDays * MS_PER_DAY;
  const stale = await listReplaysToPrune(args.db, cutoff);

  for (const row of stale) {
    // The SAME containment check the download route applies, from the same
    // single implementation: `stored_path` is a DB value, and a sweep that
    // unlinked whatever it found there would be a delete primitive pointed at
    // an untrusted string. A path outside `data/replays/` is not deleted —
    // only the row is cleared, so the bad value stops being referenced.
    const abs = resolveStoredReplayPath(row.storedPath);
    if (abs) {
      try {
        const stat = await statSize(abs);
        await rm(abs, { force: true });
        result.freedBytes += stat;
      } catch (err) {
        args.log?.(`could not delete a stored replay: ${describeError(err)}`);
        continue;
      }
    } else {
      args.log?.("a stored replay path pointed outside data/replays/ — not deleting it");
    }
    try {
      await markReplayExpired(args.db, row.id);
      result.removed += 1;
    } catch (err) {
      args.log?.(`could not mark a replay expired: ${describeError(err)}`);
    }
  }

  await removeEmptyJobDirs(args.log);
  return result;
}

/** Size on disk, or 0 when it cannot be read — the freed-bytes total is a log
 *  line, never a decision. */
async function statSize(absPath: string): Promise<number> {
  try {
    return (await stat(absPath)).size;
  } catch {
    return 0;
  }
}

/** Tidy up `data/replays/<jobId>/` once its last file is gone. Cosmetic, and
 *  deliberately never recursive: only an ALREADY-empty directory is removed. */
async function removeEmptyJobDirs(log?: (message: string) => void): Promise<void> {
  const root = replaysRoot();
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return; // nothing stored yet
  }
  for (const entry of entries) {
    const dir = resolve(root, entry);
    try {
      const contents = await readdir(dir);
      if (contents.length === 0) await rm(dir, { recursive: false, force: true });
    } catch (err) {
      log?.(`could not tidy a replay directory: ${describeError(err)}`);
    }
  }
}
