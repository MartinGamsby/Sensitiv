import { useState } from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { TimeoutCombobox } from "./timeout-combobox.tsx";
import { renderIntl } from "../test-support/intl.tsx";

function Harness() {
  const [value, setValue] = useState<number | undefined>(undefined);
  return (
    <>
      <output data-testid="seconds">{value ?? "default"}</output>
      <TimeoutCombobox value={value} onChange={setValue} />
    </>
  );
}

describe("<TimeoutCombobox />", () => {
  it("defaults to 480 seconds and the selected label reads 8 minutes", () => {
    renderIntl(<TimeoutCombobox onChange={() => {}} />);
    const select = screen.getByLabelText("Timeout") as HTMLSelectElement;
    expect(select.value).toBe("8");
    const selected = select.selectedOptions[0]!;
    expect(selected.textContent).toBe("8 minutes");
  });

  it("emits the chosen minutes as seconds", () => {
    renderIntl(<Harness />);
    const select = screen.getByLabelText("Timeout") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "15" } });
    expect(screen.getByTestId("seconds").textContent).toBe("900");
  });
});
