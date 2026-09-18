import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { ThemeSwitcher } from "./theme-switcher.tsx";
import {
  THEME_STORAGE_KEY,
  applyTheme,
  isTheme,
  themeBootstrapScript,
} from "@/lib/theme.ts";
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

describe("themeBootstrapScript", () => {
  it("carries the real storage key, not a client-reference stand-in", () => {
    // The bug this guards: `THEME_STORAGE_KEY` used to live in the client
    // component, and a value imported from a `"use client"` module into the
    // server layout is a client REFERENCE, not the value — so the shipped
    // script read `localStorage.getItem(undefined)`, matched nothing, and the
    // theme silently never survived a page load.
    const src = themeBootstrapScript();
    expect(src).toContain('"sensitiv.theme"');
    expect(src).not.toContain("undefined");
  });

  it("only ever writes an explicit choice onto the root", () => {
    // "system" must leave `<html>` bare so the media query stays live.
    expect(themeBootstrapScript()).toContain('t==="light"||t==="dark"');
    expect(themeBootstrapScript()).not.toContain('"system"');
  });

  it("cannot throw on a browser that refuses storage", () => {
    // It runs before anything else on the page; an exception here would take
    // the whole document with it.
    expect(themeBootstrapScript()).toContain("catch");
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

  it("re-applies the stored theme on mount, not just the active segment", () => {
    // Switching locale re-mounts the root layout, and the pre-paint script
    // only runs on a full document load. Without this the segment would light
    // up correctly over a page painted in the other theme — which is exactly
    // what "I picked light, changed language, and it went back" was.
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    document.documentElement.removeAttribute("data-theme");

    renderIntl(<ThemeSwitcher />);

    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("clears a stale attribute when the stored choice is 'match system'", () => {
    document.documentElement.setAttribute("data-theme", "dark");
    localStorage.setItem(THEME_STORAGE_KEY, "system");

    renderIntl(<ThemeSwitcher />);

    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
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
