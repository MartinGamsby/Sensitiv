import { Composition, staticFile, type CalculateMetadataFunction } from "remotion";
import { scenarios } from "../scenarios/index.ts";
import { scenarioFor } from "./config/scenario.ts";
import { Demo, type DemoProps } from "./Demo.tsx";
import { EMPTY_MANIFEST, MANIFEST_FILE, type AssetManifest } from "./lib/assets.ts";
import { buildTimeline } from "./lib/timeline.ts";

/** The manifest `pnpm video:assets` wrote, or an empty one — never a failure. */
async function loadManifest(signal: AbortSignal): Promise<AssetManifest> {
  try {
    const res = await fetch(staticFile(MANIFEST_FILE), { signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as Partial<AssetManifest>;
    return { ...EMPTY_MANIFEST, ...body, version: 1 };
  } catch (err) {
    console.warn(`No asset manifest (${String(err)}): run \`pnpm video:assets\`. Maps and photos will be blank.`);
    return EMPTY_MANIFEST;
  }
}

const calculateMetadata: CalculateMetadataFunction<DemoProps> = async ({ props, abortSignal }) => {
  const found = scenarios.find((s) => s.id === props.scenarioId);
  if (!found) throw new Error(`Unknown scenario "${props.scenarioId}"`);
  const scenario = scenarioFor(found, props.variant ?? "video");
  const { fps, width, height } = scenario.video;
  return {
    durationInFrames: buildTimeline(scenario.timing, fps).durationInFrames,
    fps,
    width,
    height,
    props: { ...props, manifest: await loadManifest(abortSignal) },
    defaultOutName: scenario.id,
  };
};

/** One composition per scenario, named after it. */
export function RemotionRoot() {
  return (
    <>
      {scenarios.map((scenario) => (
        <Composition
          key={scenario.id}
          id={scenario.id}
          component={Demo}
          durationInFrames={buildTimeline(scenario.timing, scenario.video.fps).durationInFrames}
          fps={scenario.video.fps}
          width={scenario.video.width}
          height={scenario.video.height}
          defaultProps={{ scenarioId: scenario.id } satisfies DemoProps}
          calculateMetadata={calculateMetadata}
        />
      ))}
    </>
  );
}
