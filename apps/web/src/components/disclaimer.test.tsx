import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { Disclaimer } from "./disclaimer.tsx";
import { renderIntl } from "../test-support/intl.tsx";

describe("<Disclaimer />", () => {
  it("renders the exact English string under `en`", () => {
    renderIntl(<Disclaimer />, { locale: "en" });
    expect(
      screen.getByText(
        "This is research assistance, not medical, legal, or housing advice.",
      ),
    ).toBeTruthy();
  });

  it("renders the exact French string under `fr`", () => {
    renderIntl(<Disclaimer />, { locale: "fr" });
    expect(
      screen.getByText(
        "Ceci est une aide à la recherche, et non un avis médical, juridique ou immobilier.",
      ),
    ).toBeTruthy();
  });
});
