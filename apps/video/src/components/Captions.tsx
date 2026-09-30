import { useVideoConfig } from "remotion";
import { useVideo } from "../context.tsx";
import type { Caption } from "../config/scenario.ts";
import { glide, progress } from "../lib/anim.ts";
import { at, beatEnd, beatStart, within, type Timeline } from "../lib/timeline.ts";
import { RichText } from "./RichText.tsx";

type CaptionKey = "where" | "requirement" | "request" | "research" | "dossier" | "evidence" | "map";

/** When each walkthrough caption is on screen, in walkthrough frames. */
export function captionWindows(tl: Timeline): Array<{ key: CaptionKey; from: number; to: number }> {
  return [
    { key: "where", from: within(tl, "openMap", 0.15), to: beatEnd(tl, "radius") },
    { key: "requirement", from: within(tl, "toChips", 0.35), to: beatEnd(tl, "requirement") },
    { key: "request", from: within(tl, "toRequest", 0.35), to: beatEnd(tl, "submit") },
    { key: "research", from: at(tl, "research", 1.3), to: beatEnd(tl, "research") },
    { key: "dossier", from: at(tl, "results", 0.7), to: beatEnd(tl, "results") },
    { key: "evidence", from: beatStart(tl, "evidence"), to: beatEnd(tl, "evidence") },
    { key: "map", from: at(tl, "mapView", 0.4), to: beatStart(tl, "exit") },
  ];
}

/** The lower-left caption that says what each beat is showing. */
export function Captions({ f }: { f: number }) {
  const { scenario, timeline, theme, height } = useVideo();
  const { fps } = useVideoConfig();
  const u = height / 1080;

  return (
    <>
      {captionWindows(timeline).map(({ key, from, to }) => {
        const inT = progress(f, from, 0.45 * fps, glide);
        const outT = progress(f, to - 0.3 * fps, 0.3 * fps);
        const v = inT * (1 - outT);
        if (v <= 0) return null;
        return (
          <CaptionCard
            key={key}
            caption={scenario.copy.captions[key]}
            visible={v}
            rise={(1 - inT) * 18 * u - outT * 10 * u}
            u={u}
            glass={theme.glass}
            border={theme.glassBorder}
          />
        );
      })}
    </>
  );
}

function CaptionCard({
  caption,
  visible,
  rise,
  u,
  glass,
  border,
}: {
  caption: Caption;
  visible: number;
  rise: number;
  u: number;
  glass: string;
  border: string;
}) {
  const { theme } = useVideo();
  return (
    <div
      style={{
        position: "absolute",
        left: 72 * u,
        bottom: 64 * u,
        maxWidth: 640 * u,
        opacity: visible,
        transform: `translateY(${rise}px)`,
        display: "flex",
        gap: 18 * u,
        alignItems: "flex-start",
        padding: `${22 * u}px ${28 * u}px ${24 * u}px ${24 * u}px`,
        borderRadius: 20 * u,
        background: glass,
        border: `1px solid ${border}`,
        backdropFilter: `blur(${18 * u}px) saturate(1.2)`,
        boxShadow: `0 ${20 * u}px ${50 * u}px -${16 * u}px rgb(0 0 0 / 0.55)`,
      }}
    >
      {caption.kicker ? (
        <span
          style={{
            flexShrink: 0,
            width: 40 * u,
            height: 40 * u,
            marginTop: 2 * u,
            borderRadius: 999,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            background: theme.brand,
            color: theme.brandFg,
            fontSize: 20 * u,
            fontWeight: 700,
          }}
        >
          {caption.kicker}
        </span>
      ) : (
        <span
          style={{
            flexShrink: 0,
            width: 6 * u,
            alignSelf: "stretch",
            borderRadius: 999,
            background: theme.brand,
          }}
        />
      )}
      <span style={{ minWidth: 0 }}>
        <RichText
          text={caption.title}
          style={{
            display: "block",
            fontSize: 38 * u,
            lineHeight: 1.12,
            fontWeight: 650,
            letterSpacing: "-0.025em",
            color: theme.fg,
          }}
        />
        {caption.body ? (
          <RichText
            text={caption.body}
            style={{
              display: "block",
              marginTop: 8 * u,
              fontSize: 22 * u,
              lineHeight: 1.4,
              color: theme.fgMuted,
            }}
          />
        ) : null}
      </span>
    </div>
  );
}
