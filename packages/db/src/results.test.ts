import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import type { Database } from "./client.ts";
import { createJob, finishJob, setJobPlan, setJobSourceModes } from "./jobs.ts";
import { users } from "./schema.ts";
import { getOrCreateLocalUser } from "./users.ts";
import {
  addEvidence,
  addPlaceSource,
  addReplay,
  getDossier,
  getReplayForJob,
  listJobSummariesForUser,
  setPlaceScore,
  upsertPlace,
} from "./results.ts";
import { makeTestDb } from "../test/helpers.ts";
import { sampleJobInput } from "../test/fixtures.ts";

/** A second real user row — `jobs.user_id` is a foreign key, so an ownership
 *  test that plants "another user's" job needs one to actually exist. */
async function makeOtherUser(handle: Database): Promise<string> {
  const id = randomUUID();
  await handle.db.insert(users).values({
    id,
    email: `${id}@example.test`,
    uiLocale: "en",
    defaultTimeoutSec: 480,
    createdAt: Date.now(),
  });
  return id;
}

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

describe("the dossier derives its scores, it does not read them", () => {
  it("ignores the stored score and the stored deltas", async () => {
    // The distinguishing test for this whole design: store numbers that are
    // deliberately WRONG, and check the dossier reports the ones the rubric
    // works out from the evidence. If `getDossier` ever goes back to reading
    // the row's numbers, this is what catches it.
    handle = await makeTestDb();
    const user = await getOrCreateLocalUser(handle.db);
    const job = await createJob(handle.db, sampleJobInput(user.id));
    const place = await upsertPlace(handle.db, job.id, {
      name: "Brunch Spot",
      canonicalKey: "brunch-spot|plateau",
    });
    await addEvidence(handle.db, place.id, {
      requirementId: "req_celiac",
      claim: "dedicated gluten-free kitchen",
      polarity: "supports",
      quote: "cuisine sans gluten dédiée",
      source: "google_maps",
      sourceUrl: "https://maps.google.com/x",
      confidence: 0.9,
    });

    await setPlaceScore(handle.db, place.id, 999, true, [
      {
        requirementId: "nonsense",
        rule: "corroborated",
        delta: 999,
        weight: 42,
        reason: "a stale rubric said so",
      },
    ]);

    const dossier = await getDossier(handle.db, job.id, user.id);
    // (1 + 0.9) * the requirement's weight of 3 — not 999, and not the stored
    // line's 42.
    expect(dossier?.places[0]?.score).toBe(5.7);
    expect(dossier?.places[0]?.conflicted).toBe(false);
    // `nonsense` survives as a requirement — for a run with no recorded plan
    // the breakdown is the only record of what was researched — but only as an
    // `unverified` line worth 0, because no evidence settles it.
    const lines = dossier?.places[0]?.breakdown ?? [];
    expect(lines.find((l) => l.requirementId === "nonsense")).toMatchObject({
      rule: "unverified",
      delta: 0,
    });
  });

  it("recovers a legacy run's planner requirement from its stored breakdown", async () => {
    // A run planned before `planned_requirements_json` existed knows only its
    // chips, and re-scoring on the chips alone DROPS the free-text requirement
    // — which ranked a chocolate shop above a taqueria on a search for a
    // taqueria. The stored breakdown is the only record those runs kept, so
    // the requirement list is rebuilt from it.
    handle = await makeTestDb();
    const user = await getOrCreateLocalUser(handle.db);
    const job = await createJob(handle.db, sampleJobInput(user.id));
    const place = await upsertPlace(handle.db, job.id, {
      name: "Taqueria",
      canonicalKey: "taqueria|plateau",
    });
    await addEvidence(handle.db, place.id, {
      requirementId: "custom_mexican",
      claim: "categorised as a Mexican restaurant",
      polarity: "supports",
      quote: "Mexican restaurant",
      source: "google_maps",
      sourceUrl: "https://maps.google.com/x",
      confidence: 0.9,
    });
    await setPlaceScore(handle.db, place.id, 5.7, false, [
      {
        requirementId: "custom_mexican",
        rule: "explicit",
        delta: 5.7,
        weight: 3,
        reason: "a source explicitly marks this requirement",
      },
    ]);

    const dossier = await getDossier(handle.db, job.id, user.id);
    // The recorded weight of 3 is honoured, so the requirement keeps the
    // standing it had — not the ad-hoc fallback of 1 it would get if the
    // requirement had been dropped from the plan.
    expect(dossier?.places[0]?.score).toBe(5.7);
    expect(dossier?.requirements.map((r) => r.id)).toEqual([
      "req_celiac",
      "custom_mexican",
    ]);
  });

  it("scores a place that has no stored score at all", async () => {
    // Every row written before the score column existed, and any row a run
    // never got around to scoring. The evidence is all it takes.
    handle = await makeTestDb();
    const user = await getOrCreateLocalUser(handle.db);
    const job = await createJob(handle.db, sampleJobInput(user.id));
    const place = await upsertPlace(handle.db, job.id, {
      name: "Old Place",
      canonicalKey: "old-place|plateau",
    });
    await addEvidence(handle.db, place.id, {
      requirementId: "req_celiac",
      claim: "a reviewer got glutened",
      polarity: "contradicts",
      quote: "je suis tombé malade",
      source: "google_maps",
      sourceUrl: "https://maps.google.com/x",
      confidence: 0.5,
    });

    const dossier = await getDossier(handle.db, job.id, user.id);
    expect(dossier?.places[0]?.score).toBe(-4.5); // -(1 + 0.5) * 3
  });

  it("scores against the PLANNED requirements once the worker records them", async () => {
    // The bug that made this whole change necessary: the planner's own
    // requirements lived only inside each place's frozen breakdown, so the
    // read path could not see them. A free-text requirement the planner minted
    // must count for its own weight here, and appear in the ceiling the
    // dossier divides by.
    handle = await makeTestDb();
    const user = await getOrCreateLocalUser(handle.db);
    const job = await createJob(handle.db, sampleJobInput(user.id));
    const place = await upsertPlace(handle.db, job.id, {
      name: "Taqueria",
      canonicalKey: "taqueria|plateau",
    });
    await addEvidence(handle.db, place.id, {
      requirementId: "custom_mexican",
      claim: "categorised as a Mexican restaurant",
      polarity: "supports",
      quote: "Mexican restaurant",
      source: "google_maps",
      sourceUrl: "https://maps.google.com/x",
      confidence: 0.9,
    });

    // Before the plan is recorded, the run only knows about the chip, so the
    // cuisine evidence falls back to the ad-hoc weight of 1.
    const before = await getDossier(handle.db, job.id, user.id);
    expect(before?.places[0]?.score).toBe(1.9);
    expect(before?.requirements.map((r) => r.id)).toEqual(["req_celiac"]);

    await setJobPlan(handle.db, job.id, {
      requirements: [
        ...sampleJobInput(user.id).requirements,
        {
          id: "custom_mexican",
          label: "Mexican restaurant",
          intentIds: ["intent_dining"],
          must: [],
          nice: [],
          weight: 3,
          satisfiedBy: [],
          kind: "subject",
        },
      ],
      intentIds: ["intent_dining"],
    });

    const after = await getDossier(handle.db, job.id, user.id);
    expect(after?.places[0]?.score).toBe(5.7); // (1 + 0.9) * 3
    expect(after?.requirements.map((r) => r.id)).toEqual([
      "req_celiac",
      "custom_mexican",
    ]);
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
    // Derived: three supporting claims at 0.9 from ONE source, so `explicit`
    // at (1 + 0.9) * the requirement's weight of 3, and no corroboration
    // bonus — three quotes off one page are one source agreeing with itself.
    expect(dossier?.places[0]?.score).toBe(5.7);
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
    // No `setJobSourceModes` call in this test — NULL column, never a guess.
    expect(dossier?.sourceModes).toEqual({});
  });

  it("surfaces the job's recorded sourceModes", async () => {
    handle = await makeTestDb();
    const user = await getOrCreateLocalUser(handle.db);
    const job = await createJob(handle.db, sampleJobInput(user.id));
    await setJobSourceModes(handle.db, job.id, {
      llm: "fixture",
      google_maps: "live",
    });
    await finishJob(handle.db, job.id, "done");

    const dossier = await getDossier(handle.db, job.id, user.id);
    expect(dossier?.sourceModes).toEqual({ llm: "fixture", google_maps: "live" });
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

describe("listJobSummariesForUser", () => {
  it("returns placeCount and the highest-scoring topPlace, ordered like getDossier", async () => {
    handle = await makeTestDb();
    const user = await getOrCreateLocalUser(handle.db);
    const job = await createJob(handle.db, sampleJobInput(user.id));

    // Stored scores that say the OPPOSITE of the evidence. The History card
    // re-scores like the dossier does, so the winner is decided by the
    // evidence — two screens must never name a different top place.
    const stale = await upsertPlace(handle.db, job.id, {
      name: "Stale Hundred",
      canonicalKey: "stale|plateau",
    });
    await setPlaceScore(handle.db, stale.id, 100, false);
    await addEvidence(handle.db, stale.id, {
      requirementId: "req_celiac",
      claim: "one review mentions gluten-free options",
      polarity: "supports",
      quote: "options sans gluten",
      source: "google_maps",
      sourceUrl: "https://maps.google.com/x",
      confidence: 0.4,
    });

    const real = await upsertPlace(handle.db, job.id, {
      name: "Stale Zero",
      canonicalKey: "real|plateau",
    });
    await setPlaceScore(handle.db, real.id, 0, false);
    await addEvidence(handle.db, real.id, {
      requirementId: "req_celiac",
      claim: "dedicated gluten-free kitchen",
      polarity: "supports",
      quote: "cuisine sans gluten dédiée",
      source: "google_maps",
      sourceUrl: "https://maps.google.com/x",
      confidence: 0.9,
    });
    await finishJob(handle.db, job.id, "done");

    const summaries = await listJobSummariesForUser(handle.db, user.id);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.placeCount).toBe(2);
    expect(summaries[0]?.topPlace).toEqual({
      // The row stored 0; its evidence is worth (1 + 0.9) * 3. The row that
      // stored 100 has one weak claim and comes second at 4.2.
      name: "Stale Zero",
      score: 5.7,
      conflicted: false,
    });

    // ...and it is the same place, and the same number, the dossier leads with.
    const dossier = await getDossier(handle.db, job.id, user.id);
    expect(dossier?.places[0]?.place.name).toBe("Stale Zero");
    expect(dossier?.places[0]?.score).toBe(5.7);
    expect(dossier?.places[1]?.score).toBe(4.2);
  });

  it("returns placeCount: 0 and no topPlace for a run with no places", async () => {
    handle = await makeTestDb();
    const user = await getOrCreateLocalUser(handle.db);
    await createJob(handle.db, sampleJobInput(user.id));

    const summaries = await listJobSummariesForUser(handle.db, user.id);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.placeCount).toBe(0);
    expect(summaries[0]?.topPlace).toBeUndefined();
  });

  it("never returns another user's job, even indirectly via place data", async () => {
    handle = await makeTestDb();
    const user = await getOrCreateLocalUser(handle.db);
    const otherUserId = await makeOtherUser(handle);
    const mine = await createJob(handle.db, sampleJobInput(user.id));
    const theirs = await createJob(handle.db, sampleJobInput(otherUserId));
    const theirPlace = await upsertPlace(handle.db, theirs.id, {
      name: "Not Yours",
      canonicalKey: "not-yours|elsewhere",
    });
    await setPlaceScore(handle.db, theirPlace.id, 5, false);

    const summaries = await listJobSummariesForUser(handle.db, user.id);
    expect(summaries.map((s) => s.job.id)).toEqual([mine.id]);
    expect(JSON.stringify(summaries)).not.toContain("Not Yours");

    // The boundary holds from the other side too — the ids handed to the
    // places query come from this user's OWN listJobsForUser result.
    expect(await listJobSummariesForUser(handle.db, "someone-else")).toEqual([]);
  });
});

describe("a rubric change reaches a dossier that was already run", () => {
  it("re-weights a catalog chip from the catalog, not from the stored row", async () => {
    // The whole promise of scoring on read. `sampleJobInput` enqueues its chip
    // with a stored weight of 3; `celiac` is 6 in the catalog today. An old
    // dossier must score against today's rubric, or "change a weight and
    // everything re-ranks" is only true for runs that happen afterwards.
    handle = await makeTestDb();
    const user = await getOrCreateLocalUser(handle.db);
    const input = sampleJobInput(user.id);
    input.requirements = [
      { ...input.requirements[0]!, id: "celiac", catalogId: "celiac", weight: 3 },
    ];
    const job = await createJob(handle.db, input);
    const place = await upsertPlace(handle.db, job.id, {
      name: "Brunch Spot",
      canonicalKey: "brunch-spot|plateau",
    });
    await addEvidence(handle.db, place.id, {
      requirementId: "celiac",
      claim: "dedicated gluten-free kitchen",
      polarity: "supports",
      quote: "cuisine sans gluten dédiée",
      source: "google_maps",
      sourceUrl: "https://maps.google.com/x",
      confidence: 0.9,
    });

    const dossier = await getDossier(handle.db, job.id, user.id);
    // (1 + 0.9) * 6 from the catalog, not * 3 from the row.
    expect(dossier?.places[0]?.score).toBe(11.4);
    expect(dossier?.requirements[0]?.weight).toBe(6);
  });
});
