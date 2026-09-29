import { AbsoluteFill, useCurrentFrame } from "remotion";
import { useVideo } from "../../context.tsx";
import { BrowserWindow } from "../../components/BrowserWindow.tsx";
import { Captions } from "../../components/Captions.tsx";
import { CursorLayer } from "../../components/Cursor.tsx";
import { shotFor, shotTransform } from "../../lib/camera.ts";
import { AgentPanel } from "./AgentPanel.tsx";
import { FormPage } from "./FormPage.tsx";
import { RunPage } from "./RunPage.tsx";

/**
 * The product itself: the form filled in, the run researching, the dossier,
 * one place's evidence and the map — one continuous browser window, with a
 * camera that leans in on whatever is being done.
 */
export function Walkthrough() {
  const f = useCurrentFrame();
  const { chor, scenario, width, height } = useVideo();

  const win = chor.window(f);
  const shot = shotFor(win, chor.camera(f), { width, height });

  const swap = chor.pageSwap(f);
  const onRun = chor.page(f) === "run";
  const mapView = chor.run.mapView(f) >= 0.5;
  const base = scenario.brand.address.replace(/\/+$/, "");
  const address = onRun
    ? `${base}/${scenario.locale}/jobs/${scenario.run.jobId}${mapView ? "?view=map" : ""}`
    : `${base}/${scenario.locale}`;

  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ transformOrigin: "0 0", transform: shotTransform(shot) }}>
        <BrowserWindow placement={win} address={address}>
          {swap < 1 ? (
            <div style={{ position: "absolute", inset: 0, opacity: 1 - swap }}>
              <FormPage f={f} />
            </div>
          ) : null}
          {swap > 0 ? (
            <div style={{ position: "absolute", inset: 0, opacity: swap }}>
              <RunPage f={f} />
            </div>
          ) : null}
          <CursorLayer f={f} />
        </BrowserWindow>
      </AbsoluteFill>
      <AgentPanel f={f} />
      <Captions f={f} />
    </AbsoluteFill>
  );
}
