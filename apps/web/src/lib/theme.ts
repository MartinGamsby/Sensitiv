// The theme preference, and the pre-paint script that applies it.
//
// NOT a `"use client"` module, and that is the whole reason this file exists.
// These constants used to live in `theme-switcher.tsx`, which is a client
// component, and the SERVER layout imported `THEME_STORAGE_KEY` from it to
// build the bootstrap script. A value imported from a `"use client"` module
// into a server component is not the value — it is a client-reference proxy —
// so `JSON.stringify(THEME_STORAGE_KEY)` produced `undefined` and the shipped
// script read `localStorage.getItem(undefined)`. It never matched, so the
// theme was never applied on a page load; it only survived inside one client
// session, where `applyTheme` had already written the attribute by hand.
//
// Anything the server inlines into the page belongs here, in a module both
// sides may import for real.

/**
 * `system` is a real third choice, not a default the other two replace: a
 * reader whose laptop flips to dark in the evening asked for that, and a
 * two-state toggle would silently pin them to whatever they last tapped.
 */
export const THEMES = ["system", "light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

export const THEME_STORAGE_KEY = "sensitiv.theme";

export function isTheme(value: unknown): value is Theme {
  return typeof value === "string" && (THEMES as readonly string[]).includes(value);
}

/**
 * Put the choice on `<html>`, exactly as the pre-paint script does.
 *
 * `system` REMOVES the attribute rather than resolving it to a colour here.
 * The `prefers-color-scheme` block in `globals.css` then does the work, which
 * means the page keeps following the OS live — resolving it in JS would
 * freeze whatever the OS happened to be at load.
 */
export function applyTheme(theme: Theme, root: HTMLElement): void {
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
}

/** The stored choice, or `system` when there is none or storage is unusable. */
export function readStoredTheme(): Theme {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(raw) ? raw : "system";
  } catch {
    // Private mode, blocked site data, a locked-down profile: the preference
    // is a convenience and the page renders correctly without it.
    return "system";
  }
}

/**
 * The script the layout inlines in `<head>`, as source text.
 *
 * It runs before the first paint, which is the point: the preference lives in
 * `localStorage`, the server cannot know it, and without this a reader who
 * chose light gets a dark page (or the reverse) until React mounts.
 *
 * It writes the attribute ONLY for an explicit choice — "follow the system"
 * deliberately leaves `<html>` bare so the `prefers-color-scheme` block stays
 * live and the page keeps tracking the OS after load.
 *
 * Built by a function rather than written as a template literal at the call
 * site so there is something to assert on: `theme.test.ts` checks that the
 * real key is in the emitted source, which is exactly the bug described at
 * the top of this file.
 */
export function themeBootstrapScript(): string {
  return (
    `(function(){try{var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});` +
    `if(t==="light"||t==="dark"){document.documentElement.setAttribute("data-theme",t);}` +
    `}catch(e){}})();`
  );
}
