import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { isAppLocale, routing } from "@/i18n/routing.ts";
import { Link } from "@/i18n/navigation.ts";
import { LocaleSwitcher } from "@/components/locale-switcher.tsx";
import { Disclaimer } from "@/components/disclaimer.tsx";
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
  const t = await getTranslations({ locale, namespace: "nav" });

  return (
    <html lang={locale}>
      <body className="min-h-screen bg-white text-gray-900 antialiased dark:bg-gray-950 dark:text-gray-100">
        <NextIntlClientProvider messages={messages}>
          <div className="mx-auto flex min-h-screen max-w-3xl flex-col px-4 py-6">
            <header className="mb-6 flex items-center justify-between gap-4">
              <Link href="/" className="text-lg font-semibold tracking-tight">
                Sensitiv
              </Link>
              <nav className="flex items-center gap-4 text-sm">
                <Link href="/jobs" className="text-gray-600 hover:underline dark:text-gray-300">
                  {t("history")}
                </Link>
                <LocaleSwitcher />
              </nav>
            </header>

            <main className="flex-1">{children}</main>

            <footer className="mt-10 border-t border-gray-200 pt-4 dark:border-gray-800">
              <Disclaimer />
            </footer>
          </div>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
