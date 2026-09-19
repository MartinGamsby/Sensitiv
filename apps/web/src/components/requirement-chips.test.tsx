import { useState } from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { RequirementChips } from "./requirement-chips.tsx";
import { renderIntl } from "../test-support/intl.tsx";

function Harness() {
  const [chipIds, setChipIds] = useState<string[]>([]);
  const [chipIntents, setChipIntents] = useState<Record<string, string[]>>({});
  const [allergens, setAllergens] = useState<string[]>([]);
  const [diet, setDiet] = useState<string | undefined>(undefined);
  return (
    <>
      <output data-testid="chip-ids">{chipIds.join(",")}</output>
      <output data-testid="chip-intents">
        {Object.entries(chipIntents)
          .map(([id, ids]) => `${id}=${ids.join("+")}`)
          .join(",")}
      </output>
      <RequirementChips
        value={chipIds}
        onChange={setChipIds}
        intents={chipIntents}
        onIntentsChange={setChipIntents}
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

  it("ticking Celiac searches dining only — grocery is an opt-in, not a default", () => {
    // The regression this whole mechanism exists for: `celiac` declares
    // `["dining", "grocery"]`, and ticking it used to search BOTH, so a run for
    // a Mexican restaurant also ran "gluten free grocery store".
    renderIntl(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Celiac" }));
    expect(screen.getByTestId("chip-intents").textContent).toBe("celiac=dining");
    expect(screen.getByText("Look for this in:")).toBeTruthy();
  });

  it("the intent picker adds and removes, but never leaves a chip with nowhere to look", () => {
    renderIntl(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Celiac" }));
    fireEvent.click(screen.getByRole("button", { name: "Grocery" }));
    expect(screen.getByTestId("chip-intents").textContent).toBe(
      "celiac=dining+grocery",
    );
    fireEvent.click(screen.getByRole("button", { name: "Dining" }));
    expect(screen.getByTestId("chip-intents").textContent).toBe("celiac=grocery");
    // Last one standing stays on: a chip with no intent is not a narrower
    // search, it is a chip that silently does nothing.
    fireEvent.click(screen.getByRole("button", { name: "Grocery" }));
    expect(screen.getByTestId("chip-intents").textContent).toBe("celiac=grocery");
  });

  it("un-ticking a chip drops its intents rather than keeping a stale entry", () => {
    renderIntl(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Celiac" }));
    fireEvent.click(screen.getByRole("button", { name: "Celiac" }));
    expect(screen.getByTestId("chip-intents").textContent).toBe("");
  });

  it("two chips with a choice each get named headings, not two identical ones", () => {
    renderIntl(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Celiac" }));
    fireEvent.click(screen.getByRole("button", { name: "Rental mold" }));
    expect(screen.queryByText("Look for this in:")).toBeNull();
    expect(screen.getByText("Celiac:")).toBeTruthy();
    expect(screen.getByText("Rental mold:")).toBeTruthy();
  });

  it("chip labels come from the catalog (French under locale fr)", () => {
    renderIntl(<Harness />, { locale: "fr" });
    expect(screen.getByRole("button", { name: "Maladie cœliaque" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Allergie alimentaire" }),
    ).toBeTruthy();
  });
});
