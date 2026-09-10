import { defineRouting } from "next-intl/routing";

// The UI ships in English (default) and French only. Routes are locale-prefixed:
// `/en/...` and `/fr/...`. The middleware redirects `/` to the best match.
export const routing = defineRouting({
  locales: ["en", "fr"],
  defaultLocale: "en",
  localePrefix: "always",
});

export type AppLocale = (typeof routing.locales)[number];

export function isAppLocale(value: string): value is AppLocale {
  return (routing.locales as readonly string[]).includes(value);
}
