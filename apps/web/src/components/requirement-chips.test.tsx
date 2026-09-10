import { useState } from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { RequirementChips } from "./requirement-chips.tsx";
import { renderIntl } from "../test-support/intl.tsx";

function Harness() {
  const [chipIds, setChipIds] = useState<string[]>([]);
  const [allergens, setAllergens] = useState<string[]>([]);
  const [diet, setDiet] = useState<string | undefined>(undefined);
  return (
    <>
      <output data-testid="chip-ids">{chipIds.join(",")}</output>
      <RequirementChips
        value={chipIds}
        onChange={setChipIds}
        allergens={allergens}
        onAllergensChange={setAllergens}
        diet={diet}
        onDietChange={setDiet}
      />
    </>
  );
}

describe("<RequirementChips />", () => {
  it("selecting Celiac + Food allergy yields chipIds ['celiac','allergy'] in catalog order", () => {
    renderIntl(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Food allergy" }));
    fireEvent.click(screen.getByRole("button", { name: "Celiac" }));
    expect(screen.getByTestId("chip-ids").textContent).toBe("celiac,allergy");
  });

  it("selecting Food allergy reveals the allergen multi-select", () => {
    renderIntl(<Harness />);
    expect(screen.queryByText("Which allergens?")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Food allergy" }));
    expect(screen.getByText("Which allergens?")).toBeTruthy();
    expect(screen.getByLabelText("Peanut")).toBeTruthy();
  });

  it("selecting Special diet reveals the diet picker", () => {
    renderIntl(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Special diet" }));
    expect(screen.getByText("Which diet?")).toBeTruthy();
    expect(screen.getByLabelText("Halal")).toBeTruthy();
  });

  it("chip labels come from the catalog (French under locale fr)", () => {
    renderIntl(<Harness />, { locale: "fr" });
    expect(screen.getByRole("button", { name: "Maladie cœliaque" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Allergie alimentaire" }),
    ).toBeTruthy();
  });
});
