import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { JobHistory } from "./job-history.tsx";
import { renderIntl } from "../test-support/intl.tsx";

interface Row {
  id: string;
  status: string;
  requestText: string;
  location: { query: string };
  createdAt: number;
  sourceModes?: Record<string, "fixture" | "live" | "stub">;
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

  it("shows no badge for a live run whose only non-live sources are stubs", async () => {
    // Every `dining` job resolves the v1.1 no-op adapters. If they counted as
    // fixtures this badge would be on every card in the list, forever.
    stubJobs([
      {
        id: "job-1",
        status: "done",
        requestText: "fully live run",
        location: { query: "Plateau" },
        createdAt: Date.now(),
        sourceModes: {
          llm: "live",
          google_maps: "live",
          yelp: "stub",
          find_me_gluten_free: "stub",
        },
        placeCount: 1,
        topPlace: { name: "Place", score: 1, conflicted: false },
      },
    ]);

    renderIntl(<JobHistory />);
    expect(await screen.findByText("fully live run")).toBeTruthy();
    expect(screen.queryByText("Sample data")).toBeNull();
    expect(screen.queryByText("Provenance not recorded")).toBeNull();
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

describe("<JobHistory /> deleting a run", () => {
  function twoRuns(): Row[] {
    return [
      {
        id: "job-1",
        status: "done",
        requestText: "first run",
        location: { query: "Plateau" },
        createdAt: Date.now(),
      },
      {
        id: "job-2",
        status: "done",
        requestText: "second run",
        location: { query: "Rosemont" },
        createdAt: Date.now(),
      },
    ];
  }

  /** `GET /api/jobs` for the list, then whatever the DELETE should answer. */
  function stubWithDelete(rows: Row[], deleteStatus = 200) {
    const calls: Array<{ url: string; method: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) => {
        calls.push({ url, method: init?.method ?? "GET" });
        if (init?.method === "DELETE") {
          return Promise.resolve({ ok: deleteStatus < 400, status: deleteStatus });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ jobs: rows }) });
      }),
    );
    return calls;
  }

  it("asks before deleting, and does not call the API on the first click", async () => {
    const calls = stubWithDelete(twoRuns());
    renderIntl(<JobHistory />);
    await screen.findByText("first run");

    fireEvent.click(screen.getAllByRole("button", { name: "Delete this run" })[0]!);

    expect(
      screen.getByText("Delete this run and everything it found?"),
    ).toBeTruthy();
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    // Still on screen: arming the control changes nothing on the server.
    expect(screen.getByText("first run")).toBeTruthy();
  });

  it("only ever arms one row at a time", async () => {
    // Two live delete buttons in one list is how the wrong run goes.
    stubWithDelete(twoRuns());
    renderIntl(<JobHistory />);
    await screen.findByText("first run");

    const triggers = screen.getAllByRole("button", { name: "Delete this run" });
    fireEvent.click(triggers[0]!);
    fireEvent.click(triggers[1]!);

    expect(
      screen.getAllByText("Delete this run and everything it found?"),
    ).toHaveLength(1);
    expect(triggers[0]!.getAttribute("aria-expanded")).toBe("false");
    expect(triggers[1]!.getAttribute("aria-expanded")).toBe("true");
  });

  it("removes only the confirmed row, and says what survives", async () => {
    const calls = stubWithDelete(twoRuns());
    renderIntl(<JobHistory />);
    await screen.findByText("first run");

    fireEvent.click(screen.getAllByRole("button", { name: "Delete this run" })[0]!);
    // The note is the promise the user cares about: the pages already read
    // stay cached, so re-running does not start from scratch.
    expect(screen.getByText(/stay cached/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(screen.queryByText("first run")).toBeNull());
    expect(screen.getByText("second run")).toBeTruthy();
    expect(calls).toContainEqual({ url: "/api/jobs/job-1", method: "DELETE" });
  });

  it("keeps the row and says so when the server refuses", async () => {
    // A 409 is the honest case: the run is still going.
    stubWithDelete(twoRuns(), 409);
    renderIntl(<JobHistory />);
    await screen.findByText("first run");

    fireEvent.click(screen.getAllByRole("button", { name: "Delete this run" })[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(await screen.findByText(/could not be deleted/)).toBeTruthy();
    expect(screen.getByText("first run")).toBeTruthy();
  });

  it("backs out on 'Keep it' without calling anything", async () => {
    const calls = stubWithDelete(twoRuns());
    renderIntl(<JobHistory />);
    await screen.findByText("first run");

    fireEvent.click(screen.getAllByRole("button", { name: "Delete this run" })[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Keep it" }));

    expect(
      screen.queryByText("Delete this run and everything it found?"),
    ).toBeNull();
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    expect(screen.getByText("first run")).toBeTruthy();
  });
});
