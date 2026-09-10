import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { SolariKeyField, SOLARI_KEY_STORAGE } from "./solari-key-field.tsx";
import { renderIntl } from "../test-support/intl.tsx";

function health(solari: boolean): typeof fetch {
  return (async () =>
    new Response(JSON.stringify({ solari }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
}

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

describe("<SolariKeyField />", () => {
  it("is absent when /api/health reports solari: true", async () => {
    renderIntl(<SolariKeyField onChange={() => {}} fetchImpl={health(true)} />);
    // Give the mount effect a tick, then assert it never appears.
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByLabelText("Solari API key")).toBeNull();
  });

  it("renders the field + banner when solari: false, stores only in sessionStorage", async () => {
    const onChange = vi.fn();
    renderIntl(
      <SolariKeyField onChange={onChange} fetchImpl={health(false)} />,
    );

    const input = (await screen.findByLabelText(
      "Solari API key",
    )) as HTMLInputElement;
    expect(input.getAttribute("type")).toBe("password");
    expect(
      screen.getByText(
        "Key stays in this browser tab. Don't use this pattern on a public server.",
      ),
    ).toBeTruthy();

    fireEvent.change(input, { target: { value: "sk-test-123" } });

    await waitFor(() => {
      expect(sessionStorage.getItem(SOLARI_KEY_STORAGE)).toBe("sk-test-123");
    });
    expect(localStorage.getItem(SOLARI_KEY_STORAGE)).toBeNull();
    expect(onChange).toHaveBeenCalledWith("sk-test-123");
  });
});
