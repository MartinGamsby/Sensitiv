import { useState } from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import type { SearchLanguage } from "@sensitiv/shared";
import { LanguageCombobox } from "./language-combobox.tsx";
import { renderIntl } from "../test-support/intl.tsx";

function Harness({
  region,
  country,
}: {
  region?: string;
  country?: string;
}) {
  const [value, setValue] = useState<SearchLanguage | null>(null);
  return (
    <>
      <output data-testid="value">
        {value ? `${value.code}:${value.source}` : "auto"}
      </output>
      <LanguageCombobox
        location={{ region, country }}
        value={value}
        onChange={setValue}
      />
    </>
  );
}

describe("<LanguageCombobox />", () => {
  it("defaults to Auto", () => {
    renderIntl(<Harness />);
    const select = screen.getByLabelText("Search language") as HTMLSelectElement;
    expect(select.value).toBe("auto");
    expect(screen.getByTestId("value").textContent).toBe("auto");
  });

  it("shows the resolved code as a hint — Quebec/CA resolves to fr", () => {
    renderIntl(<Harness region="Quebec" country="CA" />);
    expect(screen.getByRole("option", { name: "Auto (fr)" })).toBeTruthy();
  });

  it("a user selection reports source 'user'", () => {
    renderIntl(<Harness country="US" />);
    const select = screen.getByLabelText("Search language") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "es" } });
    expect(screen.getByTestId("value").textContent).toBe("es:user");
  });
});
