import { describe, expect, it } from "vitest";
import type { Dossier, JobEvent } from "@sensitiv/shared";
import type { Job } from "@sensitiv/db";
import { RunSnapshotSchema } from "../config/run-snapshot.ts";
import { keepLogLine, toSnapshot } from "./to-snapshot.ts";

const job: Job = {
  id: "34d414fb-c33f-4c2d-97b6-1b606b8d8dda",
  userId: "u1",
  status: "done",
  location: { query: "Ville-Marie, Montreal, Quebec", lat: 45.508, lng: -73.5686, radiusKm: 1, pinned: true },
  requestText: "Mexican restaurant",
  requirements: [],
  intentIds: ["dining"],
  plannedRequirements: [],
  plannedIntentIds: ["dining"],
  searchLang: "en",
  uiLocale: "en",
  timeoutSec: 480,
  errorText: null,
  createdAt: Date.parse("2026-09-19T01:49:06.892Z"),
  startedAt: 1_000_000,
  finishedAt: 1_129_483,
  sourceModes: { llm: "live", google_maps: "live", openstreetmap: "live" },
  recordSession: false,
  quickSearch: undefined,
  searchCenter: { lat: 45.508, lng: -73.5686 },
} as unknown as Job;

const place = (name: string, thumbnailUrl?: string) => ({
  place: { name, canonicalKey: name.toLowerCase(), thumbnailUrl, lat: 45.51, lng: -73.56, url: "https://example.com/menu" },
  sources: [{ source: "google_maps", sourceUrl: "https://www.google.com/maps/place/x", rating: 4.7, reviewCount: 989 }],
  evidence: [
    {
      requirementId: "celiac",
      claim: "A reviewer identifying as celiac reported eating safely",
      polarity: "supports" as const,
      quote: "I am celiac and ate tacos, shrimp, salad and rice safely.",
      source: "google_maps",
      sourceUrl: "https://www.google.com/maps/place/x",
      confidence: 0.6,
    },
  ],
  score: 10.9,
  breakdown: [{ requirementId: "celiac", rule: "supported" as const, delta: 7.2, weight: 6, reason: "a source supports this requirement" }],
  conflicted: false,
});

const dossier: Dossier = {
  jobId: job.id,
  status: "done",
  uiLocale: "en",
  searchLang: "en",
  requirements: [
    { id: "celiac", label: "Celiac", intentIds: ["dining"], must: [], nice: [], weight: 6, satisfiedBy: [], kind: "preference" },
  ],
  searchCenter: { lat: 45.508, lng: -73.5686 },
  places: [
    place("La Selva", "https://lh3.googleusercontent.com/a-/ALV-UjW5qj"),
    place("Escondite", "https://lh3.googleusercontent.com/grass-cs/ACvplmNPb6"),
    place("Nowhere", "http://insecure.example.com/photo.jpg"),
  ],
  replays: [],
  disclaimer: "This is research assistance, not medical, legal, or housing advice.",
  sourceModes: { llm: "live", google_maps: "live", openstreetmap: "live" },
} as Dossier;

const events: JobEvent[] = [
  { id: 1, jobId: job.id, ts: "2026-09-19T01:49:07.000Z", level: "info", message: 'job started — "Mexican restaurant"', progress: { phase: "start" } },
  { id: 2, jobId: job.id, ts: "2026-09-19T01:49:13.700Z", level: "info", message: "[google_maps] browser session AnjYBVwTzwQU4JCF" },
  { id: 3, jobId: job.id, ts: "2026-09-19T01:49:14.000Z", level: "debug", message: '[google_maps] searching "gluten free Mexican restaurant" (anchored)' },
] as JobEvent[];

describe("keepLogLine", () => {
  it("drops the line naming a browser session", () => {
    expect(keepLogLine("[google_maps] browser session AnjYBVwTzwQU4JCF")).toBe(false);
    expect(keepLogLine("[google_maps] opening La Toxica for: Celiac")).toBe(true);
  });
});

describe("toSnapshot", () => {
  const report = toSnapshot(job, dossier, events, new Date("2026-09-28T00:00:00Z"));
  const snapshot = report.snapshot;

  it("produces a snapshot the scenario schema accepts", () => {
    expect(RunSnapshotSchema.safeParse(snapshot).success).toBe(true);
  });

  it("never keeps a reviewer's face or a non-https photo", () => {
    expect(snapshot.places.map((p) => p.photo)).toEqual([
      undefined,
      "https://lh3.googleusercontent.com/grass-cs/ACvplmNPb6",
      undefined,
    ]);
    expect(report.photosKept).toBe(1);
  });

  it("keeps no links: listing, source and website URLs stay behind", () => {
    const json = JSON.stringify(snapshot);
    expect(json).not.toContain("google.com/maps");
    expect(json).not.toContain("example.com/menu");
  });

  it("drops the session id, keeps the rest of the log on the run's own clock", () => {
    expect(snapshot.log.map((e) => e.message)).toEqual([
      'job started — "Mexican restaurant"',
      '[google_maps] searching "gluten free Mexican restaurant" (anchored)',
    ]);
    expect(snapshot.log[1]!.t).toBe(7);
    expect(snapshot.log[0]!.progress).toEqual({ phase: "start" });
  });

  it("takes the duration from the job, as the run page's 'Took' does", () => {
    expect(snapshot.durationSec).toBeCloseTo(129.483, 3);
  });

  it("computes the run's yardstick", () => {
    // celiac 6 × 2.5, plus proximity 2 because the run has a centre.
    expect(snapshot.maxScore).toBe(17);
  });

  it("reports sample-data sources so the importer can refuse them", () => {
    const sample = toSnapshot(
      job,
      { ...dossier, sourceModes: { google_maps: "fixture", openstreetmap: "live" } },
      events,
      new Date(),
    );
    expect(sample.sampleSources).toEqual(["google_maps"]);
  });

  it("refuses a run that has not finished", () => {
    expect(() => toSnapshot(job, { ...dossier, status: "running" }, events, new Date())).toThrow(
      /only a finished run/,
    );
  });
});
