import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import {
  THEME_STORAGE_KEY,
  ThemeSwitcher,
  applyTheme,
  isTheme,
} from "./theme-switcher.tsx";
import { renderIntl } from "../test-support/intl.tsx";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});

describe("applyTheme", () => {
  it("writes an explicit choice onto the root", () => {
    const root = document.createElement("html");
    applyTheme("dark", root);
    expect(root.getAttribute("data-theme")).toBe("dark");
    applyTheme("light", root);
    expect(root.getAttribute("data-theme")).toBe("light");
  });

  it("leaves the root bare for 'system' rather than resolving it", () => {
    // The distinction that makes "match system" worth having: with no
    // attribute, the `prefers-color-scheme` block in `globals.css` stays
    // live, so an OS that flips to dark at sunset takes the page with it.
    // Resolving it to a colour here would freeze whatever the OS was at load.
    const root = document.createElement("html");
    root.setAttribute("data-theme", "dark");
    applyTheme("system", root);
    expect(root.hasAttribute("data-theme")).toBe(false);
  });
});

describe("isTheme", () => {
  it("rejects anything that is not one of the three", () => {
    // `localStorage` is user-writable, so a stored value is untrusted input
    // that ends up in a DOM attribute.
    expect(isTheme("dark")).toBe(true);
    expect(isTheme("system")).toBe(true);
    expect(isTheme("midnight")).toBe(false);
    expect(isTheme(null)).toBe(false);
  });
});

describe("<ThemeSwitcher />", () => {
  it("applies and persists a choice", () => {
    renderIntl(<ThemeSwitcher />);

    fireEvent.click(screen.getByRole("button", { name: "Dark" }));

    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(
      screen.getByRole("button", { name: "Dark" }).getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("shows the stored choice as the active segment on mount", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "light");

    renderIntl(<ThemeSwitcher />);

    expect(
      screen.getByRole("button", { name: "Light" }).getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("falls back to 'match system' when storage is unreadable", () => {
    // Private mode, blocked site data, a locked-down profile: reading can
    // throw outright, and a header that crashes takes the whole page with it.
    const getItem = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("denied");
      });

    renderIntl(<ThemeSwitcher />);

    expect(
      screen
        .getByRole("button", { name: "Match system" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    getItem.mockRestore();
  });

  it("still applies the theme when the write is refused", () => {
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("denied");
      });

    renderIntl(<ThemeSwitcher />);
    fireEvent.click(screen.getByRole("button", { name: "Dark" }));

    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    setItem.mockRestore();
  });
});
