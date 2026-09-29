import { useVideo } from "../../context.tsx";
import { TileMap } from "../../components/TileMap.tsx";
import { outBack } from "../../lib/anim.ts";
import type { FormMapState } from "../../lib/choreography.ts";
import { radiusToPixels, toViewPixel } from "../../lib/geo.ts";

/**
 * The form's map panel (`LocationMap`): the radius circle, the marker —
 * faded until a pin is dropped — and, the video's own addition, a label
 * naming the spot.
 */
export function FormMap({ state }: { state: FormMapState }) {
  const { theme, scenario } = useVideo();
  const { view } = state;
  const circle = toViewPixel(view, state.circleCenter);
  const r = radiusToPixels(state.circleCenter, state.circleKm, view.zoom);
  const marker = toViewPixel(view, state.marker);
  const dropped = state.drop > 0;
  // The pin falls from above and lands with a little overshoot.
  const fall = dropped ? (1 - outBack(2.2)(Math.min(1, state.drop * 1.6))) * -46 : 0;

  return (
    <TileMap view={view} controls>
      <svg
        width={view.width}
        height={view.height}
        style={{ position: "absolute", inset: 0, overflow: "visible" }}
      >
        <circle
          cx={circle.x}
          cy={circle.y}
          r={Math.max(0, r)}
          fill={`rgb(${theme.brandRgb} / 0.08)`}
          stroke={theme.brand}
          strokeWidth={1}
        />
        {dropped ? (
          // The ripple where the pin lands.
          <circle
            cx={marker.x}
            cy={marker.y}
            r={6 + 34 * Math.min(1, state.drop * 1.3)}
            fill="none"
            stroke={theme.brand}
            strokeWidth={2}
            opacity={Math.max(0, 0.7 - state.drop)}
          />
        ) : null}
      </svg>

      {/* The marker: the app's teal teardrop, anchored at its tip. */}
      <div
        style={{
          position: "absolute",
          left: marker.x - 16,
          top: marker.y - 30 + fall,
          width: 32,
          height: 32,
          opacity: dropped ? Math.min(1, state.drop * 4) : 0.45,
          filter: "drop-shadow(0 1px 2px rgb(0 0 0 / .4))",
        }}
      >
        <svg viewBox="0 0 24 24" width={32} height={32}>
          <path
            d="M12 22s7-6.1 7-12a7 7 0 1 0-14 0c0 5.9 7 12 7 12z"
            fill={theme.brand}
            stroke="white"
            strokeWidth="1.5"
          />
          <circle cx="12" cy="10" r="2.5" fill="white" />
        </svg>
      </div>

      {state.callout > 0 ? (
        <div
          style={{
            position: "absolute",
            left: marker.x + 20,
            top: marker.y - 58,
            opacity: state.callout,
            transform: `translate(${(1 - state.callout) * -8}px, ${(1 - state.callout) * 6}px)`,
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "5px 10px",
            borderRadius: 999,
            background: theme.name === "dark" ? "rgb(9 14 26 / 0.88)" : "rgb(255 255 255 / 0.92)",
            border: `1px solid rgb(${theme.brandRgb} / 0.55)`,
            boxShadow: "0 6px 18px rgb(0 0 0 / 0.35)",
            color: theme.fg,
            fontSize: 13,
            fontWeight: 600,
            whiteSpace: "nowrap",
          }}
        >
          <span style={{ width: 6, height: 6, borderRadius: 999, background: theme.brand }} />
          {scenario.search.pin.label}
        </div>
      ) : null}
    </TileMap>
  );
}
