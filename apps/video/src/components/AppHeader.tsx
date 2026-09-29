import { useVideo } from "../context.tsx";
import { HEADER_H, VIEWPORT } from "../lib/layout.ts";
import { MonitorIcon, MoonIcon, SunIcon } from "./icons.tsx";
import { Mark } from "./ui.tsx";

/** The app's drawn flags (`ui/flag.tsx`) — emoji flags don't render on Windows. */
function FlagFR() {
  return (
    <svg viewBox="0 0 3 2" width={18} height={12} preserveAspectRatio="none" style={{ borderRadius: 2 }}>
      <rect width="1" height="2" x="0" fill="#0055A4" />
      <rect width="1" height="2" x="1" fill="#FFFFFF" />
      <rect width="1" height="2" x="2" fill="#EF4135" />
    </svg>
  );
}

function FlagGB() {
  return (
    <svg viewBox="0 0 60 30" width={18} height={12} preserveAspectRatio="none" style={{ borderRadius: 2 }}>
      <clipPath id="video-flag-gb">
        <path d="M30,15 h30 v15 z v15 h-30 z h-30 v-15 z v-15 h30 z" />
      </clipPath>
      <rect width="60" height="30" fill="#012169" />
      <path d="M0,0 L60,30 M60,0 L0,30" stroke="#FFFFFF" strokeWidth="6" />
      <path d="M0,0 L60,30 M60,0 L0,30" clipPath="url(#video-flag-gb)" stroke="#C8102E" strokeWidth="4" />
      <path d="M30,0 v30 M0,15 h60" stroke="#FFFFFF" strokeWidth="10" />
      <path d="M30,0 v30 M0,15 h60" stroke="#C8102E" strokeWidth="6" />
    </svg>
  );
}

/** `SiteHeader`: sticky, translucent, the mark and the two nav links. */
export function AppHeader({ active }: { active: "newSearch" | "history" }) {
  const { theme, t, scenario } = useVideo();
  const link = (key: "newSearch" | "history") => (
    <span
      style={{
        whiteSpace: "nowrap",
        borderRadius: 8,
        padding: "6px 12px",
        fontSize: 14,
        fontWeight: 500,
        background: active === key ? theme.brandSoft : "transparent",
        color: active === key ? theme.brandSoftFg : theme.fgMuted,
      }}
    >
      {t(`nav.${key}`)}
    </span>
  );
  const segment = (children: React.ReactNode, on: boolean) => (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 4,
        height: 24,
        minWidth: 24,
        padding: "0 6px",
        borderRadius: 6,
        fontSize: 11,
        fontWeight: 600,
        background: on ? theme.surface : "transparent",
        color: on ? theme.fg : theme.fgSubtle,
        boxShadow: on ? theme.shadowCard : undefined,
      }}
    >
      {children}
    </span>
  );
  const group = (children: React.ReactNode) => (
    <span
      style={{
        display: "inline-flex",
        gap: 2,
        padding: 2,
        borderRadius: 8,
        background: theme.surfaceMuted,
        border: `1px solid ${theme.borderSubtle}`,
      }}
    >
      {children}
    </span>
  );

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: VIEWPORT.width,
        height: HEADER_H,
        zIndex: 20,
        borderBottom: `1px solid ${theme.borderSubtle}`,
        // Nearly opaque instead of the app's `bg/85 backdrop-blur`: backdrop
        // filters mirror their edges under the camera's transforms.
        background: `rgb(${theme.bgRgb} / 0.96)`,
      }}
    >
      <div
        style={{
          margin: "0 auto",
          width: 1024,
          height: HEADER_H,
          padding: "0 24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            fontSize: 16,
            fontWeight: 600,
            letterSpacing: "-0.01em",
            color: theme.fg,
          }}
        >
          <Mark size={32} />
          {scenario.brand.name}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {link("newSearch")}
          {link("history")}
          <span style={{ width: 1, height: 20, margin: "0 4px", background: theme.borderSubtle }} />
          {group(
            <>
              {segment(<MonitorIcon size={13} />, false)}
              {segment(<SunIcon size={13} />, theme.name === "light")}
              {segment(<MoonIcon size={13} />, theme.name === "dark")}
            </>,
          )}
          <span style={{ width: 4 }} />
          {group(
            <>
              {segment(<><FlagGB /> EN</>, scenario.locale === "en")}
              {segment(<><FlagFR /> FR</>, scenario.locale === "fr")}
            </>,
          )}
        </span>
      </div>
    </div>
  );
}
