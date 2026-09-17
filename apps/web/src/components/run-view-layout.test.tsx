import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, screen, waitFor } from "@testing-library/react";
import { RunView } from "./run-view.tsx";
import { renderIntl } from "../test-support/intl.tsx";

/**
 * Layout promises of the redesigned run view: the results lead, the raw log
 * stays folded away until someone asks for it, and a finished run never renders
 * as a bare status word above an empty page.
 */

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
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal("EventSource", FakeEventSource);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Drive the stream to a terminal status. */
function finish(es: FakeEventSource, status = "done") {
  act(() => {
    es.emit("job-status", { status });
  });
}

function logTrigger(): HTMLElement {
  return screen.getByRole("button", { name: /Activity log/ });
}

describe("<RunView /> layout", () => {
  it("keeps the activity log collapsed while the run is live", () => {
    // The progress bar, not an open wall of debug lines, is what says the run
    // is moving — so the log starts folded even mid-run.
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: false, json: () => Promise.resolve({}) })),
    );
    renderIntl(<RunView jobId="job-1" />);
    const es = FakeEventSource.instances.at(-1)!;

    act(() => {
      es.emit("job-status", { status: "running" });
    });

    expect(logTrigger().getAttribute("aria-expanded")).toBe("false");
  });

  it("keeps the activity log open once opened, even as the run finishes", async () => {
    // Regression in the other direction: the log used to be driven by the run
    // status, so it slammed shut on whoever had just opened it to read.
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: false, json: () => Promise.resolve({}) })),
    );
    renderIntl(<RunView jobId="job-1" />);
    const es = FakeEventSource.instances.at(-1)!;

    act(() => {
      es.emit("job-status", { status: "running" });
    });
    act(() => {
      logTrigger().click();
    });
    expect(logTrigger().getAttribute("aria-expanded")).toBe("true");

    finish(es);

    await waitFor(() =>
      expect(logTrigger().getAttribute("aria-expanded")).toBe("true"),
    );
  });

  it("says so when a finished run has no dossier to show", async () => {
    // Otherwise the page is the word "Done" above nothing at all.
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: false, json: () => Promise.resolve({}) })),
    );
    renderIntl(<RunView jobId="job-1" />);
    finish(FakeEventSource.instances.at(-1)!);

    expect(
      await screen.findByText(/The dossier could not be loaded/),
    ).toBeTruthy();
  });

  it("renders the dossier before the activity log", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              jobId: "job-1",
              status: "done",
              uiLocale: "en",
              searchLang: "en",
              replays: [],
              disclaimer:
                "This is research assistance, not medical, legal, or housing advice.",
              places: [],
              sourceModes: {},
            }),
        }),
      ),
    );
    const { container } = renderIntl(<RunView jobId="job-1" />);
    finish(FakeEventSource.instances.at(-1)!);

    const dossierHeading = await screen.findByRole("heading", { name: "Dossier" });
    const log = logTrigger();
    // The log used to sit above the dossier on wide screens.
    expect(
      dossierHeading.compareDocumentPosition(log) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(container).toBeTruthy();
  });
});
