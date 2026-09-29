import { AbsoluteFill, Img, useCurrentFrame, useVideoConfig } from "remotion";
import { useVideo } from "../context.tsx";
import { Mark } from "../components/ui.tsx";
import { clamp, glide, inOutCubic, outBack, progress } from "../lib/anim.ts";
import { fillTemplate } from "../lib/copy.ts";

/** The logo: the mark draws itself, the name slides out of it, the tagline follows. */
export function Brand() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { scenario, theme, vars, height, image } = useVideo();
  const u = height / 1080;
  const s = (sec: number) => sec * fps;

  const pop = progress(frame, s(0.05), s(0.6));
  const draw = progress(frame, s(0.2), s(0.6), inOutCubic);
  const check = progress(frame, s(0.7), s(0.35), inOutCubic);
  const word = progress(frame, s(0.45), s(0.7), glide);
  const sweep = progress(frame, s(1.15), s(0.9), inOutCubic);
  const logo = image(scenario.brand.logo);
  const markSize = 132 * u;
  const tagline = fillTemplate(scenario.brand.tagline, vars).split(/(\s+)/);
  let wi = 0;

  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <div
        style={{
          position: "absolute",
          width: 900 * u,
          height: 900 * u,
          borderRadius: 999,
          background: `radial-gradient(circle, rgb(${theme.brandRgb} / 0.22), transparent 62%)`,
          transform: `scale(${0.6 + 0.4 * glide(pop)})`,
          opacity: pop,
        }}
      />
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 34 * u }}>
        <div style={{ display: "flex", alignItems: "center", gap: 34 * u }}>
          <div
            style={{
              transform: `scale(${0.55 + 0.45 * outBack(1.6)(pop)})`,
              opacity: clamp(pop * 2),
            }}
          >
            {logo ? (
              <Img src={logo} style={{ height: markSize, width: "auto" }} />
            ) : (
              <Mark size={markSize} draw={draw} check={check} radius={markSize * 0.26} />
            )}
          </div>
          <div
            style={{
              position: "relative",
              clipPath: `inset(-20% ${(1 - word) * 100}% -20% 0)`,
              transform: `translateX(${(1 - word) * -24 * u}px)`,
            }}
          >
            <div
              style={{
                fontSize: 118 * u,
                lineHeight: 1,
                fontWeight: 700,
                letterSpacing: "-0.045em",
                color: theme.fg,
              }}
            >
              {scenario.brand.name}
            </div>
            {/* A single pass of light across the name. */}
            <div
              aria-hidden
              style={{
                position: "absolute",
                inset: 0,
                fontSize: 118 * u,
                lineHeight: 1,
                fontWeight: 700,
                letterSpacing: "-0.045em",
                color: "transparent",
                backgroundImage:
                  "linear-gradient(100deg, transparent 35%, rgb(255 255 255 / 0.75) 50%, transparent 65%)",
                backgroundSize: "300% 100%",
                backgroundPosition: `${100 - sweep * 100}% 0`,
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                opacity: sweep > 0 && sweep < 1 ? 1 : 0,
              }}
            >
              {scenario.brand.name}
            </div>
          </div>
        </div>
        <div
          style={{
            maxWidth: 1200 * u,
            textAlign: "center",
            fontSize: 34 * u,
            lineHeight: 1.35,
            fontWeight: 450,
            letterSpacing: "-0.01em",
            color: theme.fgMuted,
          }}
        >
          {tagline.map((w, i) => {
            if (/^\s+$/.test(w)) return <span key={i}>{w}</span>;
            const k = progress(frame, s(1.0) + wi++ * s(0.05), s(0.5), glide);
            return (
              <span
                key={i}
                style={{
                  display: "inline-block",
                  opacity: k,
                  transform: `translateY(${(1 - k) * 14 * u}px)`,
                }}
              >
                {w}
              </span>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
}
