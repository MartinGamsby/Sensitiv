import type { CSSProperties, ReactNode } from "react";
import { Img, useCurrentFrame, useVideoConfig } from "remotion";
import { useVideo } from "../context.tsx";
import {
  matchPillColors,
  placeHue,
  placeInitials,
  type Theme,
} from "../lib/theme.ts";

// The app's UI primitives (`apps/web/src/components/ui/`), restyled inline for
// the video: same radii, borders, tones and type sizes, no Tailwind.

export type BadgeTone = keyof Theme["badge"];

export function Card({
  tone = "default",
  style,
  children,
}: {
  tone?: "default" | "brand" | "muted" | "warn";
  style?: CSSProperties;
  children?: ReactNode;
}) {
  const { theme } = useVideo();
  const tones: Record<string, CSSProperties> = {
    default: {
      borderColor: theme.borderSubtle,
      background: theme.surface,
      boxShadow: theme.shadowCard,
    },
    brand: {
      borderColor: `rgb(${theme.brandRgb} / 0.25)`,
      background: theme.brandSoft,
    },
    muted: { borderColor: theme.borderSubtle, background: theme.surfaceMuted },
    warn:
      theme.name === "dark"
        ? { borderColor: "rgb(120 53 15 / 0.7)", background: "rgb(69 26 3 / 0.5)" }
        : { borderColor: "#fcd34d", background: "#fffbeb" },
  };
  return (
    <div
      style={{
        borderRadius: 12,
        borderWidth: 1,
        borderStyle: "solid",
        ...tones[tone],
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function Badge({
  tone,
  size = "sm",
  style,
  children,
}: {
  tone: BadgeTone;
  size?: "sm" | "md";
  style?: CSSProperties;
  children: ReactNode;
}) {
  const { theme } = useVideo();
  const colors = theme.badge[tone];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        whiteSpace: "nowrap",
        borderRadius: 999,
        gap: size === "sm" ? 4 : 6,
        padding: size === "sm" ? "2px 8px" : "4px 10px",
        fontSize: size === "sm" ? 11 : 12,
        fontWeight: size === "sm" ? 500 : 600,
        lineHeight: "16px",
        background: colors.bg,
        color: colors.fg,
        ...style,
      }}
    >
      {children}
    </span>
  );
}

export function MatchPill({
  percent,
  size = "sm",
  children,
  style,
}: {
  percent: number;
  size?: "sm" | "md";
  children: ReactNode;
  style?: CSSProperties;
}) {
  const { theme } = useVideo();
  const colors = matchPillColors(theme, percent);
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        whiteSpace: "nowrap",
        borderRadius: 999,
        padding: size === "sm" ? "2px 8px" : "4px 10px",
        fontSize: size === "sm" ? 11 : 12,
        fontWeight: size === "sm" ? 500 : 600,
        lineHeight: "16px",
        fontVariantNumeric: "tabular-nums",
        background: colors.bg,
        color: colors.fg,
        ...style,
      }}
    >
      {children}
    </span>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  const { theme } = useVideo();
  return (
    <span
      style={{
        display: "inline-flex",
        width: 24,
        height: 24,
        flexShrink: 0,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 999,
        background: theme.brandSoft,
        color: theme.brandSoftFg,
        fontSize: 12,
        fontWeight: 600,
      }}
    >
      {children}
    </span>
  );
}

export function SectionHeading({
  eyebrow,
  children,
  description,
}: {
  eyebrow?: ReactNode;
  children: ReactNode;
  description?: ReactNode;
}) {
  const { theme } = useVideo();
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, height: 28 }}>
        {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
        <div
          style={{
            fontSize: 18,
            lineHeight: "28px",
            fontWeight: 600,
            letterSpacing: "-0.01em",
            color: theme.fg,
          }}
        >
          {children}
        </div>
      </div>
      {description ? (
        <div style={{ marginTop: 6, fontSize: 14, lineHeight: "23px", color: theme.fgMuted }}>
          {description}
        </div>
      ) : null}
    </div>
  );
}

/** A spinning arc, driven by the frame so it renders the same every time. */
export function Spinner({ size = 16, color }: { size?: number; color?: string }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const angle = ((frame / fps) * 360 * 1.1) % 360;
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      style={{ transform: `rotate(${angle}deg)`, flexShrink: 0 }}
    >
      <circle cx="12" cy="12" r="9" fill="none" stroke={color ?? "currentColor"} strokeOpacity={0.25} strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke={color ?? "currentColor"} strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/** The running status's pulsing dot (`LiveDot` + `animate-pulse-ring`). */
export function LiveDot({ color }: { color: string }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = ((frame / fps) % 1.8) / 1.8;
  const ring = t < 0.7 ? t / 0.7 : 1;
  return (
    <span style={{ position: "relative", display: "inline-flex", width: 10, height: 10, marginTop: 5 }}>
      <span
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: 999,
          background: color,
          opacity: 0.7 * (1 - ring),
          transform: `scale(${0.9 + 0.7 * ring})`,
        }}
      />
      <span style={{ position: "relative", width: 10, height: 10, borderRadius: 999, background: color }} />
    </span>
  );
}

/** A place's photo, or its initials tile — the same size either way. */
export function PlacePhoto({
  name,
  photo,
  size = 56,
}: {
  name: string;
  photo?: string;
  size?: number;
}) {
  const { theme, image } = useVideo();
  const src = image(photo);
  if (src) {
    return (
      <Img
        src={src}
        style={{
          width: size,
          height: size,
          flexShrink: 0,
          borderRadius: 6,
          objectFit: "cover",
          background: theme.surfaceMuted,
        }}
      />
    );
  }
  const hue = placeHue(name);
  return (
    <span
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 6,
        background: `hsl(${hue} 45% 92%)`,
        color: `hsl(${hue} 55% 28%)`,
        fontSize: Math.round(size * 0.38),
        fontWeight: 600,
        letterSpacing: "0.01em",
      }}
    >
      {placeInitials(name)}
    </span>
  );
}

/** The app's pin-and-check mark (`SiteHeader`'s `Mark`). */
export function Mark({
  size = 32,
  draw = 1,
  check = 1,
  radius,
}: {
  size?: number;
  /** 0..1 — how much of the pin outline is drawn. */
  draw?: number;
  /** 0..1 — how much of the check is drawn. */
  check?: number;
  radius?: number;
}) {
  const { theme } = useVideo();
  return (
    <span
      style={{
        display: "inline-flex",
        width: size,
        height: size,
        flexShrink: 0,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: radius ?? size * 0.25,
        background: theme.brand,
        color: theme.brandFg,
        boxShadow: theme.shadowCard,
      }}
    >
      <svg
        viewBox="0 0 24 24"
        width={size * 0.5625}
        height={size * 0.5625}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path
          d="M12 21.5s7-6.6 7-11.5a7 7 0 1 0-14 0c0 4.9 7 11.5 7 11.5Z"
          pathLength={1}
          strokeDasharray={1}
          strokeDashoffset={1 - draw}
        />
        <path d="m9 9.8 2.2 2.2L15.2 8" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - check} />
      </svg>
    </span>
  );
}

// --- the rank medal and its laurel (`rank-medal.tsx`) --------------------------

const CX = 48;
const CY = 26;
const STEM_R = 23;
const LEAVES = [
  { at: 105, len: 9.5, half: 2.4 },
  { at: 122, len: 11, half: 2.8 },
  { at: 139, len: 11.5, half: 2.9 },
  { at: 156, len: 11, half: 2.8 },
  { at: 173, len: 10, half: 2.5 },
  { at: 190, len: 8.5, half: 2.2 },
];
const LEAF_TILT = 60;
const STEM_D = "M48 49C32 49 20.9 33.1 26.4 18.1";

function leafPath(len: number, half: number): string {
  return (
    `M0 0C${len * 0.3} ${-half} ${len * 0.68} ${-half} ${len} 0` +
    `C${len * 0.68} ${half} ${len * 0.3} ${half} 0 0Z`
  );
}

function LaurelBranch({ grow }: { grow: number }) {
  return (
    <g>
      <path
        d={STEM_D}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        pathLength={1}
        strokeDasharray={1}
        strokeDashoffset={1 - grow}
      />
      {LEAVES.map(({ at, len, half }, i) => {
        const rad = (at * Math.PI) / 180;
        const leaf = Math.min(1, Math.max(0, grow * LEAVES.length - i));
        return (
          <path
            key={at}
            d={leafPath(len * leaf, half * leaf)}
            transform={`translate(${(CX + STEM_R * Math.cos(rad)).toFixed(2)} ${(
              CY +
              STEM_R * Math.sin(rad)
            ).toFixed(2)}) rotate(${at + LEAF_TILT})`}
          />
        );
      })}
    </g>
  );
}

/** Rank, as a medal straddling the card's top edge; laurels for the podium. */
export function RankMedal({ rank, grow = 1, pop = 1 }: { rank: number; grow?: number; pop?: number }) {
  const { theme } = useVideo();
  const medal = rank <= 3 ? theme.medal[rank as 1 | 2 | 3] : undefined;
  return (
    <span
      style={{
        position: "absolute",
        left: "50%",
        top: 0,
        zIndex: 10,
        transform: `translate(-50%, calc(-50% - 3px)) scale(${pop})`,
      }}
    >
      <span
        style={{
          position: "relative",
          display: "flex",
          width: 36,
          height: 36,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {medal ? (
          <svg
            viewBox="0 0 96 52"
            fill="currentColor"
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              width: 96,
              height: 52,
              transform: "translate(-50%, -50%)",
              color: medal.laurel,
            }}
          >
            <LaurelBranch grow={grow} />
            <g transform="translate(96,0) scale(-1,1)">
              <LaurelBranch grow={grow} />
            </g>
          </svg>
        ) : null}
        <span
          style={{
            position: "relative",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 999,
            borderWidth: 1,
            borderStyle: "solid",
            fontWeight: 700,
            fontVariantNumeric: "tabular-nums",
            boxShadow: theme.shadowCard,
            ...(medal
              ? {
                  width: 36,
                  height: 36,
                  fontSize: 16,
                  borderColor: medal.border,
                  background: medal.bg,
                  color: medal.fg,
                }
              : {
                  width: 32,
                  height: 32,
                  fontSize: 14,
                  borderColor: theme.borderStrong,
                  background: theme.surface,
                  color: theme.fgMuted,
                }),
          }}
        >
          {rank}
        </span>
      </span>
    </span>
  );
}

/** A map pin, numbered: `pinHtml` from the app's `dossier-map.tsx`. */
export function RankPin({ rank, fill }: { rank: number; fill: string }) {
  return (
    <svg
      viewBox="0 0 28 36"
      width={28}
      height={36}
      style={{ filter: "drop-shadow(0 1px 2px rgb(0 0 0 / .45))", overflow: "visible" }}
    >
      <path
        d="M14 35.5S26 24.6 26 14A12 12 0 1 0 2 14c0 10.6 12 21.5 12 21.5z"
        fill={fill}
        stroke="#fff"
        strokeWidth="1.6"
      />
      <circle cx="14" cy="13.8" r="8" fill="#fff" />
      <text
        x="14"
        y="17.8"
        textAnchor="middle"
        fontSize="11"
        fontWeight="700"
        fill={fill}
        style={{ fontFamily: "inherit" }}
      >
        {rank}
      </text>
    </svg>
  );
}
