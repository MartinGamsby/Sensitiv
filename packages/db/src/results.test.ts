import { afterEach, describe, expect, it } from "vitest";
import type { Database } from "./client.ts";
import { createJob, finishJob } from "./jobs.ts";
import { getOrCreateLocalUser } from "./users.ts";
import {
  addEvidence,
  addPlaceSource,
  addReplay,
  getDossier,
  getReplayForJob,
  setPlaceScore,
  upsertPlace,
} from "./results.ts";
import { makeTestDb } from "../test/helpers.ts";
import { sampleJobInput } from "../test/fixtures.ts";

let handle: Database | undefined;
afterEach(() => {
  handle?.client.close();
  handle = undefined;
});

describe("upsertPlace", () => {
  it("merges on canonicalKey — one row, updated fields", async () => {
    handle = await makeTestDb();
    const user = await getOrCreateLocalUser(handle.db);
    const job = await createJob(handle.db, sampleJobInput(user.id));

    const first = await upsertPlace(handle.db, job.id, {
      name: "Cafe A",
      canonicalKey: "cafe-a|main-st",
      phone: "111",
    });
    const second = await upsertPlace(handle.db, job.id, {
      name: "Cafe A (renamed)",
      canonicalKey: "cafe-a|main-st",
      phone: "222",
    });
    expect(second.id).toBe(first.id);

    const count = await handle.client.execute("SELECT COUNT(*) AS n FROM places");
    expect(count.rows[0]?.n).toBe(1);
    const row = await handle.client.execute("SELECT name, phone FROM places");
    expect(row.rows[0]?.name).toBe("Cafe A (renamed)");
    expect(row.rows[0]?.phone).toBe("222");
  });
});

describe("getDossier", () => {
  it("assembles a place with 2 sources and 3 evidence rows", async () => {
    handle = await makeTestDb();
    const user = await getOrCreateLocalUser(handle.db);
    const job = await createJob(handle.db, sampleJobInput(user.id));

    const place = await upsertPlace(handle.db, job.id, {
      name: "Brunch Spot",
      canonicalKey: "brunch-spot|plateau",
      address: "123 Rue Rachel",
    });
    await addPlaceSource(handle.db, place.id, {
      source: "google_maps",
      sourceUrl: "https://maps.google.com/x",
      rating: 4.5,
      reviewCount: 210,
    });
    await addPlaceSource(
      handle.db,
      place.id,
      { source: "yelp", sourceUrl: "https://yelp.com/x" },
      { raw: true },
    );
    for (let i = 0; i < 3; i++) {
      await addEvidence(handle.db, place.id, {
        requirementId: "req_celiac",
        claim: `claim ${i}`,
        polarity: "supports",
        quote: "menu sans gluten dédié",
        source: "google_maps",
        sourceUrl: "https://maps.google.com/x",
        confidence: 0.9,
      });
    }
    await setPlaceScore(handle.db, place.id, 3, false);
    const { id: replayId } = await addReplay(handle.db, job.id, {
      solariSessionId: "sess_1",
      replayUrl: "https://solari.dev/replay/sess_1",
      expiresAt: 1_800_000_000_000,
      adapterId: "google_maps",
      findingCount: 3,
      status: "stored",
      storedPath: "data/replays/job-1/sess_1.ndjson.gz",
      sizeBytes: 4096,
      contentType: "application/gzip",
    });
    await finishJob(handle.db, job.id, "done");

    const dossier = await getDossier(handle.db, job.id, user.id);
    expect(dossier).toBeDefined();
    expect(dossier?.status).toBe("done");
    expect(dossier?.places).toHaveLength(1);
    expect(dossier?.places[0]?.sources).toHaveLength(2);
    expect(dossier?.places[0]?.evidence).toHaveLength(3);
    expect(dossier?.places[0]?.score).toBe(3);
    expect(dossier?.places[0]?.conflicted).toBe(false);
    expect(dossier?.replays).toEqual([
      {
        id: replayId,
        adapterId: "google_maps",
        status: "stored",
        findingCount: 3,
        sizeBytes: 4096,
        url: "https://solari.dev/replay/sess_1",
        expiresAt: 1_800_000_000_000,
      },
    ]);
    // `storedPath` never reaches the dossier — the download route resolves
    // it server-side from the row id.
    expect(JSON.stringify(dossier?.replays)).not.toContain("data/replays");
    expect(dossier?.disclaimer).toContain("aide à la recherche");
  });

  it("returns undefined for another user's job (ownership boundary)", async () => {
    handle = await makeTestDb();
    const user = await getOrCreateLocalUser(handle.db);
    const job = await createJob(handle.db, sampleJobInput(user.id));
    expect(await getDossier(handle.db, job.id, "intruder")).toBeUndefined();
  });

  it("maps a NULL status (every pre-existing row) to 'unavailable', never a live link", async () => {
    handle = await makeTestDb();
    const user = await getOrCreateLocalUser(handle.db);
    const job = await createJob(handle.db, sampleJobInput(user.id));
    // Simulates a row written before this change: no status, no metadata,
    // just the columns that always existed.
    await addReplay(handle.db, job.id, {
      solariSessionId: "sess_legacy",
      replayUrl: "https://solari.dev/replay/sess_legacy",
    });

    const dossier = await getDossier(handle.db, job.id, user.id);
    expect(dossier?.replays).toHaveLength(1);
    expect(dossier?.replays[0]?.status).toBe("unavailable");
  });
});

describe("getReplayForJob", () => {
  it("finds a replay by id and job id", async () => {
    handle = await makeTestDb();
    const user = await getOrCreateLocalUser(handle.db);
    const job = await createJob(handle.db, sampleJobInput(user.id));
    const { id } = await addReplay(handle.db, job.id, {
      solariSessionId: "sess_2",
      status: "stored",
      storedPath: "data/replays/job-2/sess_2.ndjson",
    });

    const row = await getReplayForJob(handle.db, job.id, id);
    expect(row?.storedPath).toBe("data/replays/job-2/sess_2.ndjson");
  });

  it("returns undefined for a replay belonging to a different job", async () => {
    handle = await makeTestDb();
    const user = await getOrCreateLocalUser(handle.db);
    const job = await createJob(handle.db, sampleJobInput(user.id));
    const otherJob = await createJob(handle.db, sampleJobInput(user.id));
    const { id } = await addReplay(handle.db, job.id, {
      solariSessionId: "sess_3",
      status: "stored",
      storedPath: "data/replays/job-3/sess_3.ndjson",
    });

    expect(await getReplayForJob(handle.db, otherJob.id, id)).toBeUndefined();
  });
});
