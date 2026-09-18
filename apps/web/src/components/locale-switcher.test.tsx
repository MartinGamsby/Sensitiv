import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { LocaleSwitcher } from "./locale-switcher.tsx";
import { renderIntl } from "../test-support/intl.tsx";

// `usePathname` / `useRouter` reach for the App Router's context, which no
// test renders. Only the labelling is under test here, so they are stubbed.
vi.mock("@/i18n/navigation.ts", () => ({
  usePathname: () => "/jobs",
  useRouter: () => ({ replace: vi.fn() }),
}));

describe("<LocaleSwitcher />", () => {
  it("names each language the way its own speakers do, in either UI locale", () => {
    // The point of the tooltip: someone who cannot read the current UI still
    // has to be able to find their way out of it, so "Français" is the label
    // under an English UI and "English" is the label under a French one.
    for (const locale of ["en", "fr"] as const) {
      const { unmount } = renderIntl(<LocaleSwitcher />, { locale });

      expect(screen.getByRole("button", { name: /Français/ }).title).toBe(
        "Français",
      );
      expect(screen.getByRole("button", { name: /English/ }).title).toBe(
        "English",
      );
      unmount();
    }
  });

  it("draws the flags rather than typing them, and hides them from the name", () => {
    // Emoji flags have no glyph on Windows. These are inline SVG, and they are
    // decoration beside the code and the language's own name — never the only
    // cue, and never part of the accessible name.
    const { container } = renderIntl(<LocaleSwitcher />);

    const flags = container.querySelectorAll("svg");
    expect(flags.length).toBe(2);
    for (const flag of flags) {
      expect(flag.getAttribute("aria-hidden")).toBe("true");
    }
  });
});
