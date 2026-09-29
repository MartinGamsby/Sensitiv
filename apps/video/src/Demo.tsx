import type { ReactNode } from "react";
import {
  AbsoluteFill,
  Html5Audio,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { findScenario } from "../scenarios/index.ts";
import { Stage } from "./components/Stage.tsx";
import { VideoProvider, useVideo } from "./context.tsx";
import { FONT_STACK, loadFonts } from "./fonts.ts";
import type { AssetManifest } from "./lib/assets.ts";
import { Brand } from "./scenes/Brand.tsx";
import { Hook } from "./scenes/Hook.tsx";
import { Outro } from "./scenes/Outro.tsx";
import { Walkthrough } from "./scenes/walkthrough/Walkthrough.tsx";

export interface DemoProps extends Record<string, unknown> {
  scenarioId: string;
  manifest?: AssetManifest;
}

loadFonts();

/** Fades a scene in over its first `fadeIn` frames and out over its last `fadeOut`. */
function Fade({ fadeIn, fadeOut, children }: { fadeIn: number; fadeOut: number; children: ReactNode }) {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const inT = fadeIn > 0 ? interpolate(frame, [0, fadeIn], [0, 1], { extrapolateRight: "clamp" }) : 1;
  const outT =
    fadeOut > 0
      ? interpolate(frame, [durationInFrames - fadeOut, durationInFrames], [1, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        })
      : 1;
  return <AbsoluteFill style={{ opacity: Math.min(inT, outT) }}>{children}</AbsoluteFill>;
}

/**
 * The interface sounds, each a short clip at its cue: the brand's chime as
 * its check mark draws, then every click, key and landing in the walkthrough.
 */
function Sounds() {
  const { chor, timeline, scenario, manifest } = useVideo();
  if (!scenario.audio.sfx) return null;
  const walkthrough = timeline.scenes.walkthrough.from;
  const cues = [
    { frame: timeline.scenes.brand.from + 0.72 * timeline.fps, sound: "chime" as const, volume: 0.45 },
    ...chor.cues.map((cue) => ({ ...cue, frame: walkthrough + cue.frame })),
  ];
  return (
    <>
      {cues.map((cue, i) => {
        const file = manifest.sfx[cue.sound];
        if (!file) return null;
        return (
          <Sequence
            key={i}
            from={Math.round(cue.frame)}
            durationInFrames={Math.round(1.5 * timeline.fps)}
            layout="none"
            name={`sound: ${cue.sound}`}
          >
            <Html5Audio src={staticFile(file)} volume={cue.volume * scenario.audio.sfxVolume} />
          </Sequence>
        );
      })}
    </>
  );
}

function Scenes() {
  const { timeline, scenario, manifest } = useVideo();
  const { scenes, transition } = timeline;
  const music = scenario.audio.music ? manifest.audio[scenario.audio.music] : undefined;
  const fadeOutAudio = 1.5 * timeline.fps;
  return (
    <>
      <Stage />
      <Sequence from={scenes.hook.from} durationInFrames={scenes.hook.durationInFrames} name="Hook">
        <Fade fadeIn={0} fadeOut={transition}>
          <Hook />
        </Fade>
      </Sequence>
      <Sequence from={scenes.brand.from} durationInFrames={scenes.brand.durationInFrames} name="Brand">
        <Fade fadeIn={transition} fadeOut={transition}>
          <Brand />
        </Fade>
      </Sequence>
      <Sequence
        from={scenes.walkthrough.from}
        durationInFrames={scenes.walkthrough.durationInFrames}
        name="Walkthrough"
      >
        <Walkthrough />
      </Sequence>
      <Sequence from={scenes.outro.from} durationInFrames={scenes.outro.durationInFrames} name="Outro">
        <Fade fadeIn={transition} fadeOut={Math.round(0.4 * timeline.fps)}>
          <Outro />
        </Fade>
      </Sequence>
      <Sounds />
      {music ? (
        <Html5Audio
          src={staticFile(music)}
          volume={(f) =>
            scenario.audio.volume *
            interpolate(
              f,
              [0, timeline.fps, timeline.durationInFrames - fadeOutAudio, timeline.durationInFrames],
              [0, 1, 1, 0],
              { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
            )
          }
        />
      ) : null}
    </>
  );
}

/** One demo video, driven entirely by a scenario file. */
export function Demo({ scenarioId, manifest }: DemoProps) {
  const scenario = findScenario(scenarioId);
  if (!scenario) throw new Error(`Unknown scenario "${scenarioId}"`);
  return (
    <VideoProvider scenario={scenario} manifest={manifest}>
      <AbsoluteFill
        style={{
          fontFamily: FONT_STACK,
          fontFeatureSettings: '"cv11", "ss01"',
          WebkitFontSmoothing: "antialiased",
        }}
      >
        <style>{"*{box-sizing:border-box}"}</style>
        <Scenes />
      </AbsoluteFill>
    </VideoProvider>
  );
}
