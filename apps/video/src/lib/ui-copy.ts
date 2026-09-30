import en from "../../../web/messages/en.json";
import fr from "../../../web/messages/fr.json";

// The recreated UI speaks the web app's own words: its labels are read from
// `apps/web/messages/*.json`, so the video cannot drift from the app's copy.
// A message that goes missing there shows up here as its key, not as a crash.

export type UiLocale = "en" | "fr";

const MESSAGES: Record<UiLocale, unknown> = { en, fr };

function lookup(tree: unknown, path: string): string | undefined {
  let node: unknown = tree;
  for (const part of path.split(".")) {
    if (node === null || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? node : undefined;
}

/** Just enough ICU for the app's messages: `{name}` and one-level plurals. */
export function format(
  message: string,
  vars: Readonly<Record<string, string | number>> = {},
): string {
  const plural = message.replace(
    /\{(\w+), plural, one \{([^}]*)\} other \{([^}]*)\}\}/g,
    (_whole, name: string, one: string, other: string) => {
      const n = Number(vars[name] ?? 0);
      return (n === 1 ? one : other).replace(/#/g, String(n));
    },
  );
  return plural.replace(/\{(\w+)\}/g, (whole, name: string) =>
    vars[name] === undefined ? whole : String(vars[name]),
  );
}

export type Translate = (path: string, vars?: Record<string, string | number>) => string;

export function translator(locale: UiLocale): Translate {
  return (path, vars) => {
    const message = lookup(MESSAGES[locale], path) ?? lookup(MESSAGES.en, path) ?? path;
    return format(message, vars);
  };
}
