import { mkdir, rm, writeFile } from "node:fs/promises";
import { basename, resolve, sep } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addReplay,
  createJob,
  findRepoRoot,
  getOrCreateLocalUser,
  type Database,
} from "@sensitiv/db";
import { __setWebDeps } from "../../../../../../server/deps.ts";
import { makeTestDb } from "../../../../../../test-support/db.ts";
import { testEnv } from "../../../../../../test-support/env.ts";
import { GET } from "./route.ts";

let handle: Database;
// Scoped under `data/replays/` (gitignored) so a real read/write round-trip
// exercises the exact same root the route resolves — a fake or mocked
// filesystem would not catch a path-escape bug.
let testDir: string;

function ctx(id: string, replayId: string): { params: Promise<{ id: string; replayId: string }> } {
  return { params: Promise.resolve({ id, replayId }) };
}

async function seedJob(userId: string): Promise<string> {
  const job = await createJob(handle.db, {
    userId,
    location: { query: "Montreal" },
    requestText: "test",
    requirements: [
      { id: "celiac", label: "Celiac", intentIds: ["dining"], must: [], nice: [] },
    ],
    intentIds: ["dining"],
    searchLang: "en",
    uiLocale: "en",
    timeoutSec: 480,
  });
  return job.id;
}

beforeEach(async () => {
  handle = await makeTestDb();
  __setWebDeps({ db: handle.db, env: testEnv() });
  testDir = resolve(findRepoRoot(), "data", "replays", `route-test-${Date.now()}`);
  await mkdir(testDir, { recursive: true });
});

afterEach(async () => {
  __setWebDeps(undefined);
  handle.client.close();
  await rm(testDir, { recursive: true, force: true });
});

describe("GET /api/jobs/:id/replays/:replayId", () => {
  it("happy path: attachment, nosniff, and no content-encoding header", async () => {
    const user = await getOrCreateLocalUser(handle.db);
    const jobId = await seedJob(user.id);
    const abs = resolve(testDir, "sess.ndjson.gz");
    await writeFile(abs, Buffer.from([0x1f, 0x8b, 1, 2, 3]));
    const storedPath = abs.slice(resolve(findRepoRoot()).length + 1).split(sep).join("/");

    const { id: replayId } = await addReplay(handle.db, jobId, {
      solariSessionId: "sess-1",
      adapterId: "google_maps",
      status: "stored",
      storedPath,
      sizeBytes: 5,
      contentType: "application/gzip",
    });

    const res = await GET(new Request("http://localhost/x"), ctx(jobId, replayId));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain("attachment");
    expect(res.headers.get("content-disposition")).toContain("google_maps");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-encoding")).toBeNull();
    expect(res.headers.get("content-type")).toBe("application/gzip");
    const body = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(body)).toEqual([0x1f, 0x8b, 1, 2, 3]);
  });

  it("404s for a replay belonging to another user's job", async () => {
    // `getCurrentUser()` always resolves the single local user in this
    // build, so "not yours" is exercised with a second, real user row
    // inserted directly (foreign_keys=ON means `jobs.user_id` has to
    // reference an existing user) and a job owned by them.
    const strangerId = "stranger-user-id";
    await handle.client.execute({
      sql: "INSERT INTO users (id, email, ui_locale, default_timeout_sec, created_at) VALUES (?, ?, 'en', 480, ?)",
      args: [strangerId, "stranger@example.test", Date.now()],
    });
    const jobId = await seedJob(strangerId);
    const abs = resolve(testDir, "sess.ndjson");
    await writeFile(abs, "line1\n");
    const storedPath = abs.slice(resolve(findRepoRoot()).length + 1).split(sep).join("/");
    const { id: replayId } = await addReplay(handle.db, jobId, {
      solariSessionId: "sess-2",
      status: "stored",
      storedPath,
      contentType: "application/x-ndjson",
    });

    const res = await GET(new Request("http://localhost/x"), ctx(jobId, replayId));
    expect(res.status).toBe(404);
  });

  it("404s when status is not 'stored'", async () => {
    const user = await getOrCreateLocalUser(handle.db);
    const jobId = await seedJob(user.id);
    const { id: replayId } = await addReplay(handle.db, jobId, {
      solariSessionId: "sess-3",
      status: "link_only",
      replayUrl: "https://replay.example/x",
    });

    const res = await GET(new Request("http://localhost/x"), ctx(jobId, replayId));
    expect(res.status).toBe(404);
  });

  it("404s when storedPath resolves outside data/replays", async () => {
    const user = await getOrCreateLocalUser(handle.db);
    const jobId = await seedJob(user.id);
    const { id: replayId } = await addReplay(handle.db, jobId, {
      solariSessionId: "sess-4",
      status: "stored",
      // Ours in shape, but points outside the allowed root.
      storedPath: "../outside.ndjson",
      contentType: "application/x-ndjson",
    });

    const res = await GET(new Request("http://localhost/x"), ctx(jobId, replayId));
    expect(res.status).toBe(404);
  });

  it("404s when the stored file is missing from disk", async () => {
    const user = await getOrCreateLocalUser(handle.db);
    const jobId = await seedJob(user.id);
    const { id: replayId } = await addReplay(handle.db, jobId, {
      solariSessionId: "sess-5",
      status: "stored",
      storedPath: `data/replays/${basename(testDir)}/does-not-exist.ndjson`,
      contentType: "application/x-ndjson",
    });

    const res = await GET(new Request("http://localhost/x"), ctx(jobId, replayId));
    expect(res.status).toBe(404);
  });
});
