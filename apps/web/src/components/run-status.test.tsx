import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen } from "@testing-library/react";
import { AUTO_COLLAPSE_MS, RunStatus } from "./run-status.tsx";
import { renderIntl, wrapIntl } from "../test-support/intl.tsx";

const STARTED = 1_700_000_000_000;
const FINISHED = STARTED + 181_000; // 3:01

function props(overrides: Record<string, unknown> = {}) {
  return {
    status: "done",
    terminal: true,
    statusLabel: "Done",
    note: "Every source that answered is in the dossier below.",
    accentClass: "",
    cardClass: "",
    glyph: null,
    startedAtMs: STARTED,
    finishedAtMs: FINISHED,
    ...overrides,
  };
}

function isOpen(): boolean {
  return screen.getByTestId("run-status").dataset["open"] === "true";
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("<RunStatus /> folding away", () => {
  it("renders already folded for a run that was finished when the page loaded", () => {
    // No open-then-collapse animation about something that happened days
    // ago — this is a bookmark or a shared link, not a run in progress.
    renderIntl(<RunStatus {...props({ initialStatus: "done" })} />);

    expect(isOpen()).toBe(false);
    // The duration survives the fold: it is the whole of what the bar said.
    expect(screen.getByTestId("run-status").textContent).toContain("Took 3:01");
  });

  it("stays open, then folds, for a run that finishes while you watch", () => {
    // The moment the bar fills is the answer to "did it work". Snapping it
    // shut instantly would throw away the feedback the reader waited for.
    const { rerender } = renderIntl(
      <RunStatus
        {...props({ status: "running", terminal: false, initialStatus: "running" })}
      />,
    );
    expect(isOpen()).toBe(true);

    rerender(wrapIntl(<RunStatus {...props({ initialStatus: "running" })} />));
    expect(isOpen()).toBe(true);

    act(() => {
      vi.advanceTimersByTime(AUTO_COLLAPSE_MS - 100);
    });
    expect(isOpen()).toBe(true);

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(isOpen()).toBe(false);
  });

  it("never folds a partial or errored run on its own", () => {
    // This card holds the only explanation of why the dossier looks the way
    // it does. Hiding that after four seconds hides the thing the reader
    // most needs.
    for (const status of ["partial", "error"]) {
      const { unmount } = renderIntl(
        <RunStatus {...props({ status, initialStatus: "running" })} />,
      );
      act(() => {
        vi.advanceTimersByTime(AUTO_COLLAPSE_MS * 3);
      });
      expect(isOpen()).toBe(true);
      unmount();
    }
  });

  it("does not fold one open by hand out from under the reader", () => {
    renderIntl(
      <RunStatus
        {...props({ status: "running", terminal: false, initialStatus: "running" })}
      />,
    );

    // Reader collapses it early, then opens it again — before the timer.
    fireEvent.click(screen.getByRole("button"));
    expect(isOpen()).toBe(false);
    fireEvent.click(screen.getByRole("button"));
    expect(isOpen()).toBe(true);

    act(() => {
      vi.advanceTimersByTime(AUTO_COLLAPSE_MS * 3);
    });
    // A control that undoes what the reader just did is worse than no
    // automation at all.
    expect(isOpen()).toBe(true);
  });

  it("can be reopened after it folded itself", () => {
    renderIntl(<RunStatus {...props({ initialStatus: "done" })} />);
    expect(isOpen()).toBe(false);

    fireEvent.click(screen.getByRole("button"));

    expect(isOpen()).toBe(true);
    expect(
      screen.getByText("Every source that answered is in the dossier below."),
    ).toBeTruthy();
  });

  it("keeps a still-running run open", () => {
    renderIntl(
      <RunStatus
        {...props({
          status: "running",
          terminal: false,
          initialStatus: "running",
          finishedAtMs: undefined,
        })}
      />,
    );

    act(() => {
      vi.advanceTimersByTime(AUTO_COLLAPSE_MS * 3);
    });
    expect(isOpen()).toBe(true);
  });
});
