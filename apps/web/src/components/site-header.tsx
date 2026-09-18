"use client";

import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation.ts";
import { LocaleSwitcher } from "./locale-switcher.tsx";
import { ThemeSwitcher } from "./theme-switcher.tsx";
import { cn } from "@/lib/cn.ts";

/** The wordmark's glyph: a pin whose centre is a check — "this place was
 *  verified against your requirements". Decorative; the wordmark is the label. */
function Mark() {
  return (
    <span
      aria-hidden="true"
      className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-brand-fg shadow-card"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-[18px] w-[18px]"
      >
        <path d="M12 21.5s7-6.6 7-11.5a7 7 0 1 0-14 0c0 4.9 7 11.5 7 11.5Z" />
        <path d="m9 9.8 2.2 2.2L15.2 8" />
      </svg>
    </span>
  );
}

function NavLink({
  href,
  active,
  className,
  children,
}: {
  href: string;
  active: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
        active
          ? "bg-brand-soft text-brand-soft-fg"
          : "text-fg-muted hover:bg-surface-muted hover:text-fg",
        className,
      )}
    >
      {children}
    </Link>
  );
}

/**
 * Sticky app bar. Translucent so long result pages scroll under it, and the
 * current section is marked with `aria-current` as well as a tint — the tint
 * alone would be the only cue for anyone who can't distinguish it.
 */
export function SiteHeader() {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const onHistory = pathname.startsWith("/jobs");

  return (
    <header className="sticky top-0 z-20 border-b border-border-subtle bg-bg/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link
          href="/"
          className="flex items-center gap-2.5 rounded-lg text-base font-semibold tracking-tight text-fg"
        >
          <Mark />
          Sensitiv
        </Link>
        <nav className="flex items-center gap-1">
          {/* Hidden on phones: the wordmark to its left already goes home, and
              three nav items plus the locale switch overflow 375px. */}
          <NavLink href="/" active={!onHistory} className="hidden sm:inline-block">
            {t("newSearch")}
          </NavLink>
          <NavLink href="/jobs" active={onHistory}>
            {t("history")}
          </NavLink>
          <span className="ml-1 h-5 w-px bg-border-subtle" aria-hidden="true" />
          {/* Hidden below `sm` for the same reason "New search" is: the two
              segmented controls plus the nav overflow 375px, and the theme is
              the one of the pair a phone already answers for itself through
              `prefers-color-scheme`. */}
          <div className="hidden sm:block">
            <ThemeSwitcher />
          </div>
          <LocaleSwitcher />
        </nav>
      </div>
    </header>
  );
}
