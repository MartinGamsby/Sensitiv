import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";
import { isAppLocale, routing } from "@/i18n/routing.ts";
import { SiteHeader } from "@/components/site-header.tsx";
import { Disclaimer } from "@/components/disclaimer.tsx";
import { THEME_STORAGE_KEY } from "@/components/theme-switcher.tsx";
import "../globals.css";

export const metadata: Metadata = {
  title: "Sensitiv",
  description: "Location + requirements multi-source research assistance.",
};

export function generateStaticParams(): Array<{ locale: string }> {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isAppLocale(locale)) notFound();
  setRequestLocale(locale);

  const messages = await getMessages();

  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        {/* Runs before the first paint, which is the whole point: the theme
            lives in `localStorage` (see `theme-switcher.tsx`) and the server
            cannot know it, so without this a reader who chose dark gets a
            white page for one frame on every navigation.

            It writes the attribute ONLY for an explicit choice. "Follow the
            system" deliberately leaves `<html>` bare so the
            `prefers-color-scheme` block in `globals.css` stays live and the
            page keeps tracking the OS after load. `suppressHydrationWarning`
            above is required because of this: React rendered the element
            without the attribute. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              `(function(){try{var t=localStorage.getItem(${JSON.stringify(
                THEME_STORAGE_KEY,
              )});if(t==="light"||t==="dark"){document.documentElement.setAttribute("data-theme",t);}}catch(e){}})();`,
          }}
        />
      </head>
      <body className="min-h-screen bg-bg text-fg antialiased">
        <NextIntlClientProvider messages={messages}>
          <div className="flex min-h-screen flex-col">
            <SiteHeader />

            <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
              {children}
            </main>

            <footer className="mt-8 border-t border-border-subtle">
              <div className="mx-auto flex max-w-5xl flex-col gap-1 px-4 py-6 sm:px-6">
                <Disclaimer />
              </div>
            </footer>
          </div>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
