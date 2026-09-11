// Where a captured replay lands on disk. `data/` is the one directory both
// the worker (cwd `apps/worker`) and the Next server (cwd `apps/web`) already
// agree on — the SQLite file lives there too, resolved the same way
// (`findRepoRoot()` in `packages/db/src/client.ts`). Replays go to
// `data/replays/<jobId>/<sessionId>.ndjson[.gz]`.
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { findRepoRoot } from "@sensitiv/db";
import type { ReplayBytes } from "./browser/solari.ts";

/** Third-party bytes at rest, on a local single-user app: 25 MB is generous
 *  for one recording and cheap to hold. No retention policy in this change —
 *  see memory/architecture.md. */
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

function replaysRoot(): string {
  return resolve(findRepoRoot(), "data", "replays");
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

/** Resolves a `replays.stored_path` value back to an absolute path, asserting
 *  it stays under `data/replays` — defence in depth for a value that is ours,
 *  never taken from a request. Returns `undefined` when it does not. */
export function resolveStoredReplay(relativePath: string): string | undefined {
  const root = replaysRoot();
  const abs = resolve(findRepoRoot(), relativePath);
  if (abs !== root && !abs.startsWith(root + sep)) return undefined;
  return abs;
}
