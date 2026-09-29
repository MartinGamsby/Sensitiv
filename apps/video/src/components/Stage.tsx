import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { useVideo } from "../context.tsx";
import { hash01 } from "../lib/anim.ts";

/**
 * Film grain as a tiling SVG noise texture. Rasterised once by the browser;
 * each frame only moves it, which is what makes it shimmer like grain.
 */
const GRAIN = `url("data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'>` +
    `<filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/>` +
    `<feColorMatrix values='0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 1.2 -0.1'/></filter>` +
    `<rect width='100%' height='100%' filter='url(#n)'/></svg>`,
)}")`;

/**
 * The world behind the fake browser: the app's night palette, three slow
 * glows in the brand's teal family, a faint dot grid and a little grain.
 * Runs under every scene, so cross-fades never flash to black.
 */
export function Stage() {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const { theme } = useVideo();
  const t = frame / fps;

  const glow = (
    color: string,
    cx: number,
    cy: number,
    r: number,
    speed: number,
    phase: number,
  ) => {
    const x = cx + Math.sin(t * speed + phase) * 0.08;
    const y = cy + Math.cos(t * speed * 0.8 + phase) * 0.07;
    return `radial-gradient(${r * width}px ${r * width * 0.8}px at ${x * 100}% ${y * 100}%, ${color}, transparent 70%)`;
  };

  return (
    <AbsoluteFill style={{ background: theme.stage.base, overflow: "hidden" }}>
      <AbsoluteFill
        style={{
          background: [
            glow(theme.stage.glowA, 0.18, 0.22, 0.55, 0.23, 0),
            glow(theme.stage.glowB, 0.86, 0.3, 0.5, 0.19, 2.1),
            glow(theme.stage.glowC, 0.62, 0.95, 0.6, 0.16, 4.2),
          ].join(", "),
        }}
      />
      {/* Dot grid, fading out toward the edges. */}
      <AbsoluteFill
        style={{
          backgroundImage: `radial-gradient(${theme.stage.grid} 1.2px, transparent 1.3px)`,
          backgroundSize: "28px 28px",
          backgroundPosition: `${(t * 4) % 28}px ${(t * 2) % 28}px`,
          maskImage: "radial-gradient(ellipse 70% 65% at 50% 50%, black 30%, transparent 100%)",
          WebkitMaskImage:
            "radial-gradient(ellipse 70% 65% at 50% 50%, black 30%, transparent 100%)",
        }}
      />
      {/* Vignette. */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse 85% 80% at 50% 45%, transparent 55%, ${
            theme.name === "dark" ? "rgb(0 0 0 / 0.55)" : "rgb(15 23 42 / 0.12)"
          } 100%)`,
        }}
      />
      <AbsoluteFill
        style={{
          backgroundImage: GRAIN,
          backgroundPosition: `${Math.round(hash01(frame) * 220)}px ${Math.round(hash01(frame + 7) * 220)}px`,
          opacity: theme.name === "dark" ? 0.07 : 0.05,
          mixBlendMode: "overlay",
          width: width,
          height: height,
        }}
      />
    </AbsoluteFill>
  );
}
