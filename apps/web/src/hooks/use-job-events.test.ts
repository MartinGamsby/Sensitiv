import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useJobEvents } from "./use-job-events.ts";

type Listener = (e: { data: string }) => void;

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  listeners: Record<string, Listener[]> = {};
  close = vi.fn();

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, fn: Listener) {
    (this.listeners[type] ??= []).push(fn);
  }

  removeEventListener(type: string, fn: Listener) {
    this.listeners[type] = (this.listeners[type] ?? []).filter((f) => f !== fn);
  }

  emit(type: string, data: unknown) {
    for (const fn of this.listeners[type] ?? []) {
      fn({ data: JSON.stringify(data) });
    }
  }
}

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useJobEvents", () => {
  it("collects job-event frames, tracks the terminal status, and closes the stream", () => {
    const { result } = renderHook(() => useJobEvents("job-1"));

    const es = FakeEventSource.instances.at(-1)!;
    expect(es.url).toContain("/api/jobs/job-1/events");

    act(() => {
      es.emit("job-event", {
        id: 1,
        jobId: "job-1",
        ts: "2024-01-01T00:00:00.000Z",
        level: "info",
        message: "planning",
      });
      es.emit("job-event", {
        id: 2,
        jobId: "job-1",
        ts: "2024-01-01T00:00:01.000Z",
        level: "info",
        message: "searching",
      });
      es.emit("job-status", { status: "done" });
    });

    expect(result.current.events.map((e) => e.message)).toEqual([
      "planning",
      "searching",
    ]);
    expect(result.current.status).toBe("done");
    expect(es.close).toHaveBeenCalled();
  });

  it("ignores duplicate ids on reconnect", () => {
    const { result } = renderHook(() => useJobEvents("job-2"));
    const es = FakeEventSource.instances.at(-1)!;

    act(() => {
      es.emit("job-event", {
        id: 5,
        jobId: "job-2",
        ts: "2024-01-01T00:00:00.000Z",
        level: "info",
        message: "only once",
      });
      es.emit("job-event", {
        id: 5,
        jobId: "job-2",
        ts: "2024-01-01T00:00:00.000Z",
        level: "info",
        message: "only once",
      });
    });

    expect(result.current.events).toHaveLength(1);
  });
});
