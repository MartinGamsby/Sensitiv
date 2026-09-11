import { describe, expect, it } from "vitest";
import { createDb } from "./client.ts";
import { runMigrations } from "./migrate.ts";
import { makeTestDb } from "../test/helpers.ts";

describe("migrations", () => {
  it("applies cleanly from an empty database", async () => {
    const { db, client } = await createDb(":memory:");
    await expect(runMigrations(db)).resolves.toBeUndefined();
    const tables = await client.execute(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
    );
    const names = tables.rows.map((r) => r.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "users",
        "user_secrets",
        "jobs",
        "job_events",
        "places",
        "place_sources",
        "evidence",
        "replays",
      ]),
    );
    client.close();
  });

  it("is a no-op when applied twice", async () => {
    const { db, client } = await makeTestDb();
    await expect(runMigrations(db)).resolves.toBeUndefined();
    client.close();
  });

  // 0001 adds the replay columns, 0002 recreates `replays` to relax
  // `replay_url`, 0003 adds the jobs column. Applying them out of order, or
  // hand-editing `meta/_journal.json` instead of regenerating, would leave a
  // fresh database missing exactly these — and every repository write into
  // them would fail only at runtime, on a real run.
  it("leaves the Section 2/3 columns present after the 0001-0003 sequence", async () => {
    const { db, client } = await createDb(":memory:");
    await runMigrations(db);

    const replayCols = await client.execute("PRAGMA table_info(replays)");
    expect(replayCols.rows.map((r) => r.name)).toEqual(
      expect.arrayContaining([
        "replay_url",
        "expires_at",
        "adapter_id",
        "finding_count",
        "status",
        "stored_path",
        "size_bytes",
        "content_type",
      ]),
    );
    // 0002 exists to make this nullable — an `unavailable` replay has no URL.
    const replayUrl = replayCols.rows.find((r) => r.name === "replay_url");
    expect(replayUrl?.notnull).toBe(0);

    const jobCols = await client.execute("PRAGMA table_info(jobs)");
    expect(jobCols.rows.map((r) => r.name)).toContain("source_modes_json");

    client.close();
  });
});
