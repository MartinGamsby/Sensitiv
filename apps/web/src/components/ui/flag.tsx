"use client";

import { useId } from "react";

/**
 * Tiny inline flags for the locale switch.
 *
 * Drawn rather than typed as emoji on purpose: Windows ships no colour flag
 * glyphs, so `🇫🇷` renders there as a pair of boxed letters — the one platform
 * this app is developed on would be the one that got the broken version.
 *
 * A flag is a country and a locale is a language, and the two are not the same
 * thing; these are a recognisable shorthand beside the code and the language's
 * own name, never the only cue. `aria-hidden` throughout: the button already
 * says "English" / "Français" to a screen reader.
 */
export type FlagProps = { className?: string };

const BASE = "inline-block h-3 w-[18px] shrink-0 rounded-[2px] ring-1 ring-black/10";

export function FlagFR({ className }: FlagProps) {
  return (
    <svg
      viewBox="0 0 3 2"
      aria-hidden="true"
      className={`${BASE} ${className ?? ""}`}
      preserveAspectRatio="none"
    >
      <rect width="1" height="2" x="0" fill="#0055A4" />
      <rect width="1" height="2" x="1" fill="#FFFFFF" />
      <rect width="1" height="2" x="2" fill="#EF4135" />
    </svg>
  );
}

export function FlagGB({ className }: FlagProps) {
  // The counterchanged red diagonals need a clip path, and a clip path needs
  // an id that is unique per render — two switchers on one page would
  // otherwise share (and fight over) the same one.
  const clipId = useId();
  return (
    <svg
      viewBox="0 0 60 30"
      aria-hidden="true"
      className={`${BASE} ${className ?? ""}`}
      preserveAspectRatio="none"
    >
      <clipPath id={clipId}>
        <path d="M30,15 h30 v15 z v15 h-30 z h-30 v-15 z v-15 h30 z" />
      </clipPath>
      <rect width="60" height="30" fill="#012169" />
      <path d="M0,0 L60,30 M60,0 L0,30" stroke="#FFFFFF" strokeWidth="6" />
      <path
        d="M0,0 L60,30 M60,0 L0,30"
        clipPath={`url(#${clipId})`}
        stroke="#C8102E"
        strokeWidth="4"
      />
      <path d="M30,0 v30 M0,15 h60" stroke="#FFFFFF" strokeWidth="10" />
      <path d="M30,0 v30 M0,15 h60" stroke="#C8102E" strokeWidth="6" />
    </svg>
  );
}

/** The flag for an app locale, or nothing for one we have not drawn. */
export function LocaleFlag({ locale, className }: { locale: string } & FlagProps) {
  if (locale === "fr") return <FlagFR className={className} />;
  if (locale === "en") return <FlagGB className={className} />;
  return null;
}
