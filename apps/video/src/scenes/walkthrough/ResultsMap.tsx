import { useVideo } from "../../context.tsx";
import { TileMap } from "../../components/TileMap.tsx";
import { RankPin } from "../../components/ui.tsx";
import { outBack } from "../../lib/anim.ts";
import { mappablePlaces, searchCenter } from "../../lib/choreography.ts";
import { radiusToPixels, toViewPixel } from "../../lib/geo.ts";
import { PIN_FILL } from "../../lib/theme.ts";

/**
 * The dossier's map view (`DossierMap`): the search radius around the run's
 * centre, a hollow ring at the centre itself, and one numbered pin per place,
 * dropping in by rank.
 */
export function ResultsMap({ f }: { f: number }) {
  const { chor, scenario, theme } = useVideo();
  const view = chor.run.resultsMap(f);
  const center = searchCenter(scenario);
  const c = toViewPixel(view, center);
  const r = radiusToPixels(center, scenario.run.location.radiusKm, view.zoom);
  const draw = chor.run.pinIn(f, 0);
  const places = mappablePlaces(scenario);

  return (
    <TileMap view={view} controls>
      <svg
        width={view.width}
        height={view.height}
        style={{ position: "absolute", inset: 0, overflow: "visible" }}
      >
        <circle
          cx={c.x}
          cy={c.y}
          r={r}
          fill={`rgb(${theme.brandRgb} / ${0.06 * draw})`}
          stroke={theme.brand}
          strokeWidth={1.5}
          pathLength={1}
          strokeDasharray={1}
          strokeDashoffset={1 - draw}
          transform={`rotate(-90 ${c.x} ${c.y})`}
        />
        <circle cx={c.x} cy={c.y} r={6} fill={theme.bg} stroke={theme.brand} strokeWidth={3} />
      </svg>
      {/* Rank 1 last, so it paints over the pins it outranks. */}
      {[...places].reverse().map((place) => {
        const p = toViewPixel(view, place);
        const t = chor.run.pinIn(f, place.rank - 1);
        if (t <= 0) return null;
        const drop = (1 - outBack(1.8)(t)) * -28;
        return (
          <div
            key={place.rank}
            style={{
              position: "absolute",
              left: p.x - 14,
              top: p.y - 35 + drop,
              opacity: Math.min(1, t * 3),
            }}
          >
            <RankPin rank={place.rank} fill={PIN_FILL[place.rank] ?? theme.brand} />
          </div>
        );
      })}
    </TileMap>
  );
}
