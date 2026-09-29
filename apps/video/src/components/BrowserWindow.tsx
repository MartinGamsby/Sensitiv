import type { ReactNode } from "react";
import { useVideo } from "../context.tsx";
import { CHROME_H, type WindowPlacement } from "../lib/choreography.ts";
import { VIEWPORT } from "../lib/layout.ts";
import { LockIcon } from "./icons.tsx";

/**
 * A browser window with the app inside it. `children` is the 1280×720
 * viewport, laid out in the app's own pixels; the whole window is scaled into
 * the frame by `placement`.
 */
export function BrowserWindow({
  placement,
  address,
  children,
}: {
  placement: WindowPlacement;
  address: string;
  children: ReactNode;
}) {
  const { theme } = useVideo();
  const dark = theme.name === "dark";
  const chromeBg = dark ? "rgb(22 30 46)" : "rgb(236 240 245)";
  const fieldBg = dark ? "rgb(12 18 32)" : "rgb(255 255 255)";

  return (
    <div
      style={{
        position: "absolute",
        left: placement.x,
        top: placement.y - CHROME_H * placement.scale,
        width: VIEWPORT.width,
        height: VIEWPORT.height + CHROME_H,
        transformOrigin: "0 0",
        transform: `scale(${placement.scale})`,
        opacity: placement.opacity,
      }}
    >
      {/* The tilt pivots on the bottom edge, so the entrance swings up into
          place rather than falling out of the top of the frame. */}
      <div
        style={{
          width: "100%",
          height: "100%",
          transformOrigin: "50% 100%",
          transform:
            placement.tilt === 0 ? undefined : `perspective(2600px) rotateX(${placement.tilt}deg)`,
          borderRadius: 14,
          overflow: "hidden",
          background: theme.bg,
          boxShadow: dark
            ? "0 0 0 1px rgb(148 163 184 / 0.14), 0 30px 80px -20px rgb(0 0 0 / 0.7), 0 60px 160px -40px rgb(45 212 191 / 0.18)"
            : "0 0 0 1px rgb(15 23 42 / 0.08), 0 30px 80px -24px rgb(15 23 42 / 0.35)",
        }}
      >
        <div
          style={{
            height: CHROME_H,
            display: "flex",
            alignItems: "center",
            padding: "0 16px",
            gap: 8,
            background: chromeBg,
            borderBottom: `1px solid ${dark ? "rgb(255 255 255 / 0.06)" : "rgb(15 23 42 / 0.08)"}`,
          }}
        >
          {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
            <span key={c} style={{ width: 12, height: 12, borderRadius: 999, background: c }} />
          ))}
          <div style={{ flex: 1, display: "flex", justifyContent: "center" }}>
            <div
              style={{
                width: 520,
                height: 28,
                borderRadius: 8,
                background: fieldBg,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                fontSize: 13,
                color: theme.fgMuted,
              }}
            >
              <LockIcon size={12} color={theme.fgSubtle} />
              <span style={{ color: theme.fg, opacity: 0.85 }}>{address}</span>
            </div>
          </div>
          <span style={{ width: 52 }} />
        </div>
        <div
          style={{
            position: "relative",
            width: VIEWPORT.width,
            height: VIEWPORT.height,
            overflow: "hidden",
            background: theme.bg,
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
