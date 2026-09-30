import { useMemo } from "react";
import { AbsoluteFill, Img, useCurrentFrame, useVideoConfig } from "remotion";
import { useVideo } from "../context.tsx";
import type { Scenario } from "../config/scenario.ts";
import { MONO_STACK } from "../fonts.ts";
import { clamp, glide, hash01, progress } from "../lib/anim.ts";
import { fillTemplate, parseEmphasis } from "../lib/copy.ts";
import { parseTagQuote } from "../lib/marks.ts";

/**
 * The opening lines, word by word, over a drift of the run's own evidence —
 * real quotes and tags the research turned up, out of focus, the "proof
 * buried in reviews" the lines talk about.
 */
/** Where the fragments float: three rows above the lines, three below, two
 *  per row — so no two ever sit on top of each other. */
const SLOTS: Array<{ y: number; left: boolean }> = [
  { y: 0.1, left: true },
  { y: 0.78, left: false },
  { y: 0.2, left: false },
  { y: 0.88, left: true },
  { y: 0.29, left: true },
  { y: 0.7, left: true },
  { y: 0.12, left: false },
  { y: 0.86, left: false },
  { y: 0.22, left: true },
  { y: 0.76, left: true },
  { y: 0.3, left: false },
  { y: 0.68, left: false },
];

/**
 * Quotes worth floating: what sources said about the ticked requirement
 * first, then anything else with some substance. Bare category labels
 * ("Mexican restaurant") and near-duplicates are left out.
 */
function pickFragments(scenario: Scenario): Array<{ text: string; tag: boolean }> {
  const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const categories = new Set(
    scenario.run.places.map((p) => norm(p.category ?? "")).filter((c) => c !== ""),
  );
  const all = scenario.run.places.flatMap((p) => p.evidence);
  all.sort(
    (a, b) =>
      Number(b.requirementId === scenario.search.requirement) -
        Number(a.requirementId === scenario.search.requirement) || b.confidence - a.confidence,
  );
  const seen = new Set<string>();
  const out: Array<{ text: string; tag: boolean }> = [];
  for (const e of all) {
    const text = e.quote.trim();
    const key = norm(text);
    const tag = parseTagQuote(text) !== undefined;
    if (text === "" || text.length > 64 || seen.has(key)) continue;
    if (!tag && ([...categories].some((c) => key.startsWith(c)) || text.length < 16)) continue;
    seen.add(key);
    out.push({ text, tag });
    if (out.length >= SLOTS.length) break;
  }
  return out;
}

export function Hook() {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const { scenario, theme, vars, width, height, image } = useVideo();
  const u = height / 1080;
  const lines = scenario.copy.hook;
  const backdrop = image(scenario.images.hookBackdrop);

  const fragments = useMemo(() => pickFragments(scenario), [scenario]);

  const lead = 0.35 * fps;
  const tail = 1.1 * fps;
  const gap = Math.max(0.6 * fps, (durationInFrames - lead - tail) / lines.length);

  return (
    <AbsoluteFill>
      {backdrop ? (
        <AbsoluteFill style={{ overflow: "hidden" }}>
          <Img
            src={backdrop}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              transform: `scale(${1.08 - 0.08 * progress(frame, 0, durationInFrames)})`,
              opacity: 0.35,
            }}
          />
          <AbsoluteFill
            style={{ background: `radial-gradient(ellipse at center, rgb(${theme.bgRgb} / 0.55), rgb(${theme.bgRgb} / 0.92))` }}
          />
        </AbsoluteFill>
      ) : null}

      {fragments.map((fragment, i) => {
        const slot = SLOTS[i]!;
        const depth = 0.35 + 0.65 * hash01(i * 3.1 + 1);
        const label = fragment.tag ? fragment.text : `“${fragment.text}”`;
        // Fit the fragment inside its half of the frame.
        const room = 0.4 * width;
        const size = Math.min((15 + 12 * depth) * u, room / (label.length * 0.52));
        const textW = label.length * size * 0.52;
        const x = slot.left
          ? 0.04 * width + hash01(i * 5.3 + 3) * Math.max(0, room - textW)
          : 0.56 * width + hash01(i * 5.3 + 3) * Math.max(0, room - textW);
        const t = frame / fps;
        const appear = progress(frame, (0.1 + i * 0.1) * fps, 0.9 * fps);
        return (
          <div
            key={fragment.text}
            style={{
              position: "absolute",
              left: x,
              top: slot.y * height,
              transform: `translate(${Math.sin(t * 0.4 + i) * 6 * u}px, ${-t * (4 + 8 * depth) * u}px)`,
              fontSize: size,
              fontFamily: fragment.tag ? MONO_STACK : undefined,
              fontStyle: fragment.tag ? undefined : "italic",
              color: theme.fg,
              opacity: appear * (0.12 + 0.26 * depth),
              filter: `blur(${(1 - depth) * 2.2 * u}px)`,
              whiteSpace: "nowrap",
            }}
          >
            {label}
          </div>
        );
      })}

      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", padding: `0 ${140 * u}px` }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 18 * u }}>
          {lines.map((line, li) => {
            const start = lead + li * gap;
            const next = lead + (li + 1) * gap;
            const dim = li < lines.length - 1 ? progress(frame, next, 0.4 * fps) : 0;
            const words = parseEmphasis(fillTemplate(line, vars)).flatMap((seg) =>
              seg.text
                .split(/(\s+)/)
                .filter((w) => w !== "")
                .map((w) => ({ w, accent: seg.accent })),
            );
            let wordIndex = 0;
            return (
              <div
                key={li}
                style={{
                  fontSize: (li === lines.length - 1 ? 64 : 60) * u,
                  lineHeight: 1.12,
                  fontWeight: 650,
                  letterSpacing: "-0.03em",
                  textAlign: "center",
                  color: theme.fg,
                  opacity: 1 - 0.55 * dim,
                  transform: `scale(${1 - 0.04 * dim})`,
                }}
              >
                {words.map((word, wi) => {
                  if (/^\s+$/.test(word.w)) return <span key={wi}>{word.w}</span>;
                  const k = progress(frame, start + wordIndex++ * 0.065 * fps, 0.55 * fps, glide);
                  return (
                    <span
                      key={wi}
                      style={{
                        display: "inline-block",
                        opacity: clamp(k * 1.3),
                        transform: `translateY(${(1 - k) * 28 * u}px)`,
                        filter: k < 1 ? `blur(${(1 - k) * 10 * u}px)` : undefined,
                        color: word.accent ? theme.brand : undefined,
                        textShadow: word.accent ? `0 0 ${28 * u}px rgb(${theme.brandRgb} / 0.35)` : undefined,
                      }}
                    >
                      {word.w}
                    </span>
                  );
                })}
              </div>
            );
          })}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
