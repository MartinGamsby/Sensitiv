import { afterEach, describe, expect, it } from "vitest";
import type { Database } from "./client.ts";
import {
  clearCachedExtractions,
  getCachedExtractions,
  pruneExpiredExtractions,
  putCachedExtractions,
} from "./extraction-cache.ts";
import { makeTestDb } from "../test/helpers.ts";

let handle: Database | undefined;
afterEach(() => {
  handle?.client.close();
  handle = undefined;
});

const HOUR = 60 * 60 * 1000;
const NOW = 1_800_000_000_000;

describe("the extraction cache always expires", () => {
  it("round-trips a stored extraction while it is live", async () => {
    handle = await makeTestDb();
    await putCachedExtractions(
      handle.db,
      "google_maps",
      [{ key: "k1", findingsJson: '[{"place":"a"}]' }],
      24,
      NOW,
    );

    const hit = await getCachedExtractions(handle.db, ["k1"], NOW + HOUR);
    expect(hit.get("k1")).toBe('[{"place":"a"}]');
  });

  it("never serves a row past its expiry, even before the sweep reaches it", async () => {
    handle = await makeTestDb();
    await putCachedExtractions(
      handle.db,
      "google_maps",
      [{ key: "k1", findingsJson: "[]" }],
      1,
      NOW,
    );

    // The row is still physically there...
    const rows = await handle.client.execute("SELECT key FROM extraction_cache");
    expect(rows.rows).toHaveLength(1);
    // ...and is still not readable. A worker that has been up for a week must
    // not serve a claim just because the prune has not run.
    const hit = await getCachedExtractions(handle.db, ["k1"], NOW + HOUR + 1);
    expect(hit.has("k1")).toBe(false);
  });

  it("refuses to write a row that would never expire", async () => {
    handle = await makeTestDb();
    await expect(
      putCachedExtractions(handle.db, "google_maps", [{ key: "k", findingsJson: "[]" }], 0),
    ).rejects.toThrow(/positive/);
    await expect(
      putCachedExtractions(handle.db, "google_maps", [{ key: "k", findingsJson: "[]" }], -1),
    ).rejects.toThrow(/positive/);
  });

  it("pushes the expiry out when the same content is extracted again", async () => {
    handle = await makeTestDb();
    await putCachedExtractions(
      handle.db,
      "google_maps",
      [{ key: "k1", findingsJson: "[]" }],
      1,
      NOW,
    );
    // Re-extracting the same content is the cheapest possible proof that it is
    // still current, so the entry is refreshed rather than left to die.
    await putCachedExtractions(
      handle.db,
      "google_maps",
      [{ key: "k1", findingsJson: '["fresh"]' }],
      1,
      NOW + HOUR,
    );

    const hit = await getCachedExtractions(handle.db, ["k1"], NOW + HOUR + 1);
    expect(hit.get("k1")).toBe('["fresh"]');
  });

  it("sweeps expired rows and leaves live ones alone", async () => {
    handle = await makeTestDb();
    await putCachedExtractions(
      handle.db,
      "google_maps",
      [{ key: "old", findingsJson: "[]" }],
      1,
      NOW,
    );
    await putCachedExtractions(
      handle.db,
      "google_maps",
      [{ key: "new", findingsJson: "[]" }],
      48,
      NOW,
    );

    expect(await pruneExpiredExtractions(handle.db, NOW + 2 * HOUR)).toBe(1);
    const rows = await handle.client.execute("SELECT key FROM extraction_cache");
    expect(rows.rows.map((r) => r.key)).toEqual(["new"]);
  });

  it("drops a whole source on demand, without waiting out the TTL", async () => {
    handle = await makeTestDb();
    await putCachedExtractions(
      handle.db,
      "google_maps",
      [{ key: "gm", findingsJson: "[]" }],
      24,
      NOW,
    );
    await putCachedExtractions(
      handle.db,
      "openstreetmap",
      [{ key: "osm", findingsJson: "[]" }],
      24,
      NOW,
    );

    await clearCachedExtractions(handle.db, "google_maps");
    const rows = await handle.client.execute("SELECT key FROM extraction_cache");
    expect(rows.rows.map((r) => r.key)).toEqual(["osm"]);
  });

  it("looks up more keys than SQLite will bind in one statement", async () => {
    handle = await makeTestDb();
    const keys = Array.from({ length: 450 }, (_, i) => `k${i}`);
    await putCachedExtractions(
      handle.db,
      "google_maps",
      keys.map((key) => ({ key, findingsJson: "[]" })),
      24,
      NOW,
    );

    const hits = await getCachedExtractions(handle.db, keys, NOW);
    expect(hits.size).toBe(450);
  });
});
