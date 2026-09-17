import type { ReactElement } from "react";
import { afterEach } from "vitest";
import { cleanup, render, type RenderResult } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../messages/en.json";
import fr from "../../messages/fr.json";

const MESSAGES = { en, fr };

afterEach(() => {
  cleanup();
});

/**
 * Wrap a component in a `NextIntlClientProvider` with the real catalogs.
 * Exported separately because `RenderResult.rerender` replaces the ROOT element
 * — passing it a bare component would drop the provider and every
 * `useTranslations` under it would throw.
 */
export function wrapIntl(
  ui: ReactElement,
  locale: "en" | "fr" = "en",
): ReactElement {
  return (
    <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]}>
      {ui}
    </NextIntlClientProvider>
  );
}

/** Render a component inside a `NextIntlClientProvider` with the real catalogs. */
export function renderIntl(
  ui: ReactElement,
  { locale = "en" }: { locale?: "en" | "fr" } = {},
): RenderResult {
  return render(wrapIntl(ui, locale));
}
