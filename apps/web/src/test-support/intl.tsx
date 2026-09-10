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

/** Render a component inside a `NextIntlClientProvider` with the real catalogs. */
export function renderIntl(
  ui: ReactElement,
  { locale = "en" }: { locale?: "en" | "fr" } = {},
): RenderResult {
  return render(
    <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]}>
      {ui}
    </NextIntlClientProvider>,
  );
}
