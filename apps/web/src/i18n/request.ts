import { getRequestConfig } from "next-intl/server";
import { isAppLocale, routing } from "./routing.ts";

// Resolves the active locale for a request and loads its message catalog.
// Server Components read these through `getTranslations`; Client Components get
// them via the `NextIntlClientProvider` mounted in `[locale]/layout.tsx`.
export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale =
    requested && isAppLocale(requested) ? requested : routing.defaultLocale;

  const messages = (await import(`../../messages/${locale}.json`)).default;
  return { locale, messages };
});
