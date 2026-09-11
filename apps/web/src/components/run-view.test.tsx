import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, screen } from "@testing-library/react";
import type { JobEvent } from "@sensitiv/shared";
import { RunView, deriveNotices } from "./run-view.tsx";
import { renderIntl } from "../test-support/intl.tsx";

function ev(partial: Partial<JobEvent> & Pick<JobEvent, "id">): JobEvent {
  return {
    jobId: "job-1",
    ts: "2024-01-01T00:00:00.000Z",
    level: "warn",
    message: "",
    ...partial,
  };
}

describe("deriveNotices", () => {
  it("returns the distinct degradation codes in display order", () => {
    const events = [
      ev({ id: 1, source: "degraded-solari" }),
      ev({ id: 2, level: "info", source: undefined }),
      ev({ id: 3, source: "degraded-llm" }),
      ev({ id: 4, source: "degraded-llm" }),
    ];
    expect(deriveNotices(events)).toEqual(["degraded-llm", "degraded-solari"]);
  });

  it("ignores unknown sources and returns nothing for a clean run", () => {
    const events = [
      ev({ id: 1, level: "info", source: "google_maps" }),
      ev({ id: 2, level: "info", message: "job finished: done" }),
    ];
    expect(deriveNotices(events)).toEqual([]);
  });
});

// --- render test ------------------------------------------------------------

type Listener = (e: { data: string }) => void;

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  listeners: Record<string, Listener[]> = {};
  close = vi.fn();
  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, fn: Listener) {
    (this.listeners[type] ??= []).push(fn);
  }
  removeEventListener(type: string, fn: Listener) {
    this.listeners[type] = (this.listeners[type] ?? []).filter((f) => f !== fn);
  }
  emit(type: string, data: unknown) {
    for (const fn of this.listeners[type] ?? []) fn({ data: JSON.stringify(data) });
  }
}

beforeEach(() => {
  FakeEventSource.instances = [];
  // jsdom has no layout; EventLog auto-scrolls on mount.
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal("EventSource", FakeEventSource);
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve({ ok: false, json: () => Promise.resolve({}) })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("RunView degradation banners", () => {
  it("shows the Anthropic banner when a `degraded-llm` event arrives", () => {
    renderIntl(<RunView jobId="job-1" />);
    const es = FakeEventSource.instances.at(-1)!;

    act(() => {
      es.emit("job-event", {
        id: 1,
        jobId: "job-1",
        ts: "2024-01-01T00:00:00.000Z",
        level: "warn",
        message: "No Anthropic API key (ANTHROPIC_API_KEY) is set",
        source: "degraded-llm",
      });
    });

    expect(screen.getByText(/No Anthropic API key\./i)).toBeTruthy();
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("shows the Solari banner, in French, when a `degraded-solari` event arrives", () => {
    renderIntl(<RunView jobId="job-1" />, { locale: "fr" });
    const es = FakeEventSource.instances.at(-1)!;

    act(() => {
      es.emit("job-event", {
        id: 1,
        jobId: "job-1",
        ts: "2024-01-01T00:00:00.000Z",
        level: "warn",
        message: "A Solari API key is set but the cloud browser could not start",
        source: "degraded-solari",
      });
    });

    expect(screen.getByText(/Navigateur Solari indisponible\./)).toBeTruthy();
  });

  it("shows no banner for a clean run", () => {
    renderIntl(<RunView jobId="job-1" />);
    const es = FakeEventSource.instances.at(-1)!;

    act(() => {
      es.emit("job-event", {
        id: 1,
        jobId: "job-1",
        ts: "2024-01-01T00:00:00.000Z",
        level: "info",
        message: "job finished: done",
      });
    });

    expect(screen.queryByRole("alert")).toBeNull();
  });
});
