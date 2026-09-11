import { afterEach, describe, expect, it } from "vitest";
import type { Database } from "./client.ts";
import { appendEvent } from "./events.ts";
import { createJob } from "./jobs.ts";
import { addReplay, upsertPlace } from "./results.ts";
import { getOrCreateLocalUser } from "./users.ts";
import { makeTestDb } from "../test/helpers.ts";
import { sampleJobInput } from "../test/fixtures.ts";

let handle: Database | undefined;
afterEach(() => {
  handle?.client.close();
  handle = undefined;
});

const TABLES = [
  "users",
  "user_secrets",
  "jobs",
  "job_events",
  "places",
  "place_sources",
  "evidence",
  "replays",
];

describe("secret-leak guard", () => {
  it("no table holds a BYOK key / ciphertext value in v1", async () => {
    handle = await makeTestDb();
    const user = await getOrCreateLocalUser(handle.db);
    const job = await createJob(handle.db, sampleJobInput(user.id));
    await appendEvent(handle.db, job.id, "info", "planning");
    await upsertPlace(handle.db, job.id, {
      name: "Somewhere",
      canonicalKey: "somewhere|street",
    });
    // The stored-replay columns (Section 2) hold a repo-relative disk path and
    // a byte count — neither is secret, but the sweep should actually see rows
    // in every column, not skip `replays` because it's empty.
    await addReplay(handle.db, job.id, {
      solariSessionId: "sess_1",
      replayUrl: "https://solari.dev/replay/sess_1",
      adapterId: "google_maps",
      findingCount: 2,
      status: "stored",
      storedPath: "data/replays/job-1/sess_1.ndjson.gz",
      sizeBytes: 2048,
      contentType: "application/gzip",
    });

    for (const table of TABLES) {
      const dump = await handle.client.execute(`SELECT * FROM ${table}`);
      const serialized = JSON.stringify(dump.rows);
      expect(serialized.toLowerCase()).not.toContain("solarikey");
      expect(serialized.toLowerCase()).not.toContain("api_key");
      // user_secrets.ciphertext must never be populated in v1.
      if (table === "user_secrets") {
        expect(dump.rows).toHaveLength(0);
      }
    }
  });
});
