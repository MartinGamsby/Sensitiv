import { afterEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { JobHistory } from "./job-history.tsx";
import { renderIntl } from "../test-support/intl.tsx";

interface Row {
  id: string;
  status: string;
  requestText: string;
  location: { query: string };
  createdAt: number;
  sourceModes?: Record<string, "fixture" | "live">;
  placeCount?: number;
  topPlace?: { name: string; score: number; conflicted: boolean };
}

function stubJobs(jobs: Row[]): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ jobs }),
      }),
    ),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("<JobHistory />", () => {
  it("renders a formatted date for a run, with a full-timestamp title on the <time>", async () => {
    const createdAt = new Date("2024-03-15T14:30:00.000Z").getTime();
    stubJobs([
      {
        id: "job-1",
        status: "done",
        requestText: "gluten free brunch",
        location: { query: "Plateau" },
        createdAt,
        sourceModes: { llm: "live" },
        placeCount: 1,
        topPlace: { name: "Café Test", score: 3, conflicted: false },
      },
    ]);

    renderIntl(<JobHistory />);
    const card = (await screen.findByText("gluten free brunch")).closest("li");
    const time = card?.querySelector("time");
    expect(time).not.toBeNull();
    expect(time?.getAttribute("dateTime")).toBe(new Date(createdAt).toISOString());
    expect(time?.getAttribute("title")).toBe(new Date(createdAt).toISOString());
    // Some non-empty, locale-formatted label — not the raw epoch number.
    expect(time?.textContent).toBeTruthy();
    expect(time?.textContent).not.toBe(String(createdAt));
  });

  it("renders different dates for two runs sharing the same title", async () => {
    stubJobs([
      {
        id: "job-1",
        status: "done",
        requestText: "Mexican Restaurant",
        location: { query: "Plateau" },
        createdAt: new Date("2024-03-15T10:00:00.000Z").getTime(),
      },
      {
        id: "job-2",
        status: "done",
        requestText: "Mexican Restaurant",
        location: { query: "Plateau" },
        createdAt: new Date("2024-06-01T10:00:00.000Z").getTime(),
      },
    ]);

    renderIntl(<JobHistory />);
    const items = await screen.findAllByText("Mexican Restaurant");
    expect(items).toHaveLength(2);
    const dates = items.map((item) =>
      item.closest("li")?.querySelector("time")?.getAttribute("dateTime"),
    );
    expect(dates[0]).not.toBe(dates[1]);
  });

  it("renders the Sample-data badge when sourceModes contains a fixture entry", async () => {
    stubJobs([
      {
        id: "job-1",
        status: "done",
        requestText: "run with fixtures",
        location: { query: "Plateau" },
        createdAt: Date.now(),
        sourceModes: { llm: "fixture", google_maps: "live" },
        placeCount: 1,
        topPlace: { name: "Place", score: 1, conflicted: false },
      },
    ]);

    renderIntl(<JobHistory />);
    expect(await screen.findByText("Sample data")).toBeTruthy();
  });

  it("renders 'Provenance not recorded' — not a live badge — when sourceModes is empty", async () => {
    stubJobs([
      {
        id: "job-1",
        status: "done",
        requestText: "old run",
        location: { query: "Plateau" },
        createdAt: Date.now(),
        sourceModes: {},
        placeCount: 0,
      },
    ]);

    renderIntl(<JobHistory />);
    expect(await screen.findByText("Provenance not recorded")).toBeTruthy();
    expect(screen.queryByText("Sample data")).toBeNull();
  });

  it("says nothing about provenance for a run that has not finished yet", async () => {
    // The worker writes `source_modes_json` once, just before `finishJob` — a
    // queued/running job has no modes YET, which is not the same claim as
    // "this run predates provenance tracking".
    stubJobs([
      {
        id: "job-1",
        status: "running",
        requestText: "in flight",
        location: { query: "Plateau" },
        createdAt: Date.now(),
        sourceModes: {},
        placeCount: 0,
      },
    ]);

    renderIntl(<JobHistory />);
    expect(await screen.findByText("in flight")).toBeTruthy();
    expect(screen.queryByText("Provenance not recorded")).toBeNull();
    expect(screen.queryByText("Sample data")).toBeNull();
  });

  it("renders 'No places found' when the run has no topPlace", async () => {
    stubJobs([
      {
        id: "job-1",
        status: "done",
        requestText: "empty run",
        location: { query: "Plateau" },
        createdAt: Date.now(),
        sourceModes: { llm: "live" },
        placeCount: 0,
      },
    ]);

    renderIntl(<JobHistory />);
    expect(await screen.findByText("No places found")).toBeTruthy();
  });

  it("renders the top place name and score when present", async () => {
    stubJobs([
      {
        id: "job-1",
        status: "done",
        requestText: "found something",
        location: { query: "Plateau" },
        createdAt: Date.now(),
        sourceModes: { llm: "live" },
        placeCount: 1,
        topPlace: { name: "Café Test", score: 3, conflicted: false },
      },
    ]);

    renderIntl(<JobHistory />);
    expect(await screen.findByText(/Top: Café Test · score \+3/)).toBeTruthy();
  });
});
