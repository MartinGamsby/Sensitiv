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
});
