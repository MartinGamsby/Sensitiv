import { useVideoConfig } from "remotion";
import { useVideo } from "../context.tsx";
import { VIEWPORT } from "../lib/layout.ts";

/**
 * The pointer and its click ripples, in the app viewport's coordinates — it
 * lives inside the browser window, so the camera carries it along.
 */
export function CursorLayer({ f }: { f: number }) {
  const { chor, theme } = useVideo();
  const { fps } = useVideoConfig();
  const cursor = chor.cursor(f);
  const rippleFrames = 0.55 * fps;

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: VIEWPORT.width,
        height: VIEWPORT.height,
        pointerEvents: "none",
        zIndex: 60,
      }}
    >
      {chor.clicks.map((click, i) => {
        const age = f - click.frame;
        if (age < 0 || age > rippleFrames || cursor.visible <= 0) return null;
        const t = age / rippleFrames;
        const eased = 1 - (1 - t) ** 3;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: click.x,
              top: click.y,
              width: 12 + 44 * eased,
              height: 12 + 44 * eased,
              transform: "translate(-50%, -50%)",
              borderRadius: 999,
              border: `2px solid ${theme.brand}`,
              background: `rgb(${theme.brandRgb} / ${0.18 * (1 - t)})`,
              opacity: 1 - t,
            }}
          />
        );
      })}
      {cursor.visible > 0 ? (
        <svg
          viewBox="0 0 24 24"
          width={26}
          height={26}
          style={{
            position: "absolute",
            left: cursor.x - 5,
            top: cursor.y - 3,
            opacity: cursor.visible,
            transformOrigin: "5px 3px",
            transform: `scale(${1 - 0.14 * cursor.press})`,
            filter: "drop-shadow(0 2px 3px rgb(0 0 0 / 0.45))",
            overflow: "visible",
          }}
        >
          <path
            d="M5 3 L5 20.5 L9.6 16.2 L12.9 23 L16 21.6 L12.8 15 L19 15 Z"
            fill="#ffffff"
            stroke="#0b1220"
            strokeWidth="1.3"
            strokeLinejoin="round"
          />
        </svg>
      ) : null}
    </div>
  );
}
