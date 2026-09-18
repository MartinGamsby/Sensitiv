import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";
import { isAppLocale, routing } from "@/i18n/routing.ts";
import { SiteHeader } from "@/components/site-header.tsx";
import { Disclaimer } from "@/components/disclaimer.tsx";
import { themeBootstrapScript } from "@/lib/theme.ts";
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
        {/* Runs before the first paint. See `lib/theme.ts` — including why
            the script is built THERE and not inlined here: a value imported
            from a `"use client"` module into this server component is a
            client reference, not the value, and inlining one produced a
            script that read `localStorage.getItem(undefined)`.

            `suppressHydrationWarning` above is required because of this:
            React rendered `<html>` without the attribute. */}
        <script dangerouslySetInnerHTML={{ __html: themeBootstrapScript() }} />
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
