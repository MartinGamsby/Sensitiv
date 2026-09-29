import { AbsoluteFill, Img, useCurrentFrame, useVideoConfig } from "remotion";
import { disclaimerFor } from "@sensitiv/shared";
import { useVideo } from "../context.tsx";
import { InfoIcon } from "../components/icons.tsx";
import { RichText } from "../components/RichText.tsx";
import { Mark } from "../components/ui.tsx";
import { glide, outBack, progress } from "../lib/anim.ts";
import { fillTemplate, parseEmphasis } from "../lib/copy.ts";

/** The close: the headline, the lockup, and the disclaimer every dossier carries. */
export function Outro() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { scenario, theme, vars, height, image } = useVideo();
  const u = height / 1080;
  const s = (sec: number) => sec * fps;
  const outro = scenario.copy.outro;
  const logo = image(scenario.brand.logo);

  const words = parseEmphasis(fillTemplate(outro.headline, vars)).flatMap((seg) =>
    seg.text
      .split(/(\s+)/)
      .filter((w) => w !== "")
      .map((w) => ({ w, accent: seg.accent })),
  );
  let wi = 0;
  const lockup = progress(frame, s(0.9), s(0.7), glide);
  const body = progress(frame, s(1.4), s(0.7), glide);
  const cta = progress(frame, s(1.8), s(0.6));
  const note = progress(frame, s(2.2), s(0.8));

  const glow = progress(frame, 0, s(1.2), glide);

  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <div
        style={{
          position: "absolute",
          width: 1100 * u,
          height: 700 * u,
          borderRadius: 999,
          background: `radial-gradient(ellipse, rgb(${theme.brandRgb} / 0.16), transparent 65%)`,
          transform: `scale(${0.8 + 0.2 * glow})`,
          opacity: glow,
        }}
      />
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 36 * u }}>
        <div
          style={{
            fontSize: 92 * u,
            lineHeight: 1.05,
            fontWeight: 700,
            letterSpacing: "-0.045em",
            color: theme.fg,
            textAlign: "center",
          }}
        >
          {words.map((word, i) => {
            if (/^\s+$/.test(word.w)) return <span key={i}>{word.w}</span>;
            const k = progress(frame, s(0.15) + wi++ * s(0.08), s(0.6), glide);
            return (
              <span
                key={i}
                style={{
                  display: "inline-block",
                  opacity: k,
                  transform: `translateY(${(1 - k) * 34 * u}px)`,
                  filter: k < 1 ? `blur(${(1 - k) * 10 * u}px)` : undefined,
                  color: word.accent ? theme.brand : undefined,
                }}
              >
                {word.w}
              </span>
            );
          })}
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 18 * u,
            opacity: lockup,
            transform: `translateY(${(1 - lockup) * 16 * u}px)`,
          }}
        >
          {logo ? (
            <Img src={logo} style={{ height: 64 * u, width: "auto" }} />
          ) : (
            <Mark size={64 * u} radius={16 * u} />
          )}
          <span style={{ fontSize: 56 * u, fontWeight: 700, letterSpacing: "-0.04em", color: theme.fg }}>
            {scenario.brand.name}
          </span>
        </div>

        {outro.body ? (
          <RichText
            text={outro.body}
            style={{
              maxWidth: 1100 * u,
              textAlign: "center",
              fontSize: 30 * u,
              lineHeight: 1.4,
              color: theme.fgMuted,
              opacity: body,
              transform: `translateY(${(1 - body) * 12 * u}px)`,
            }}
          />
        ) : null}

        {outro.cta ? (
          <span
            style={{
              padding: `${14 * u}px ${30 * u}px`,
              borderRadius: 999,
              background: theme.brand,
              color: theme.brandFg,
              fontSize: 26 * u,
              fontWeight: 600,
              opacity: cta,
              transform: `scale(${0.9 + 0.1 * outBack(1.8)(cta)})`,
              boxShadow: `0 ${10 * u}px ${40 * u}px -${10 * u}px rgb(${theme.brandRgb} / 0.6)`,
            }}
          >
            <RichText text={outro.cta} />
          </span>
        ) : null}
      </div>

      <div
        style={{
          position: "absolute",
          bottom: 54 * u,
          display: "flex",
          alignItems: "center",
          gap: 10 * u,
          fontSize: 19 * u,
          color: theme.fgMuted,
          opacity: note,
        }}
      >
        <InfoIcon size={20 * u} color={theme.fgSubtle} />
        {disclaimerFor(scenario.locale)}
      </div>
    </AbsoluteFill>
  );
}
