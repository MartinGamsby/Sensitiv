import { afterEach, describe, expect, it } from "vitest";
import { getDossier, getOrCreateLocalUser } from "@sensitiv/db";
import type { PlannedRequirement } from "@sensitiv/shared";
import { MAX_DOSSIER_PLACES, writeDossier } from "../src/dossier.ts";
import type { MergedPlace } from "../src/merge.ts";
import { makeDb, seedJob, type TestDb } from "./helpers.ts";

let handle: TestDb | undefined;
afterEach(() => {
  handle?.client.close();
  handle = undefined;
});

const CELIAC: PlannedRequirement = {
  id: "celiac",
  catalogId: "celiac",
  label: "Celiac",
  intentIds: ["dining"],
  must: ["dedicated gluten-free kitchen"],
  nice: [],
  allergens: ["gluten"],
  weight: 3,
  satisfiedBy: [],
};

/** `count` places whose confidence — and therefore score — descends with `i`. */
function makeMerged(count: number): MergedPlace[] {
  return Array.from({ length: count }, (_, i) => {
    const name = `Place ${String(i).padStart(2, "0")}`;
    return {
      place: { name, canonicalKey: `place-${String(i).padStart(2, "0")}` },
      sources: [{ source: "google_maps", sourceUrl: "https://maps.example/x" }],
      evidence: [
        {
          requirementId: "celiac",
          claim: "Listed as a gluten-free restaurant",
          polarity: "supports" as const,
          quote: "sans gluten",
          source: "google_maps",
          sourceUrl: "https://maps.example/x",
          // Descending, so the ranking is known up front.
          confidence: 0.99 - i * 0.02,
        },
      ],
    };
  });
}

describe("writeDossier — the place cap", () => {
  it("keeps the top-scoring places and drops the tail", async () => {
    handle = await makeDb();
    const job = await seedJob(handle.db);
    const merged = makeMerged(MAX_DOSSIER_PLACES + 7);

    const written = await writeDossier(
      handle.db,
      job.id,
      merged,
      [],
      async () => undefined,
      [CELIAC],
    );

    expect(written.placeCount).toBe(MAX_DOSSIER_PLACES);
    expect(written.droppedCount).toBe(7);

    const user = await getOrCreateLocalUser(handle.db);
    const dossier = await getDossier(handle.db, job.id, user.id);
    expect(dossier?.places).toHaveLength(MAX_DOSSIER_PLACES);
    // The cap cuts the bottom of the RANKING, not whatever arrived first.
    expect(dossier?.places[0]?.place.name).toBe("Place 00");
    expect(dossier?.places.map((p) => p.place.name)).not.toContain("Place 15");
  });

  it("stores no evidence for a place the cap left out", async () => {
    handle = await makeDb();
    const job = await seedJob(handle.db);

    const written = await writeDossier(
      handle.db,
      job.id,
      makeMerged(MAX_DOSSIER_PLACES + 3),
      [],
      async () => undefined,
      [CELIAC],
    );

    // One evidence row per place, so the count follows the cap rather than
    // leaving orphaned rows behind for a place nothing will ever render.
    expect(written.evidenceCount).toBe(MAX_DOSSIER_PLACES);
  });

  it("leaves a run that fits entirely alone", async () => {
    handle = await makeDb();
    const job = await seedJob(handle.db);

    const written = await writeDossier(
      handle.db,
      job.id,
      makeMerged(4),
      [],
      async () => undefined,
      [CELIAC],
    );

    expect(written.placeCount).toBe(4);
    expect(written.droppedCount).toBe(0);
  });

  it("says in the log how many it left out, and names them", async () => {
    handle = await makeDb();
    const job = await seedJob(handle.db);
    const lines: string[] = [];

    await writeDossier(
      handle.db,
      job.id,
      makeMerged(MAX_DOSSIER_PLACES + 2),
      [],
      async (_level, message) => {
        lines.push(message);
      },
      [CELIAC],
    );

    expect(lines.some((l) => l.includes(`kept the top ${MAX_DOSSIER_PLACES} of 17`))).toBe(
      true,
    );
    expect(lines.some((l) => l.startsWith("left out:") && l.includes("Place 16"))).toBe(
      true,
    );
  });
});
