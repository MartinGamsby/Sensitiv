import type { CSSProperties } from "react";
import { useVideo } from "../../context.tsx";
import { ChevronIcon } from "../../components/icons.tsx";
import { Badge, Card, MatchPill, PlacePhoto, RankMedal } from "../../components/ui.tsx";
import type { SnapshotPlace } from "../../config/run-snapshot.ts";
import { outBack } from "../../lib/anim.ts";
import { photoRef } from "../../lib/assets.ts";
import { requirementLabel } from "../../lib/copy.ts";
import { consensusFor, placePercent, requirementMarks } from "../../lib/marks.ts";

/**
 * One result, as the dossier's grid shows it (`DossierPlaceCard`): rank medal
 * on the top edge, photo over the match, name, address, category and one pill
 * per requirement. `enter` animates it in (0 → 1).
 */
export function PlaceCard({
  place,
  rank,
  enter,
  width,
  height,
  highlight = 0,
}: {
  place: SnapshotPlace;
  rank: number;
  enter: number;
  width: number;
  height: number;
  /** 0..1 — a brand-coloured ring, for the card the cursor is about to open. */
  highlight?: number;
}) {
  const { scenario, theme, t } = useVideo();
  const run = scenario.run;
  const percent = placePercent(run, place);
  const marks = requirementMarks(place.breakdown);
  const conflicted =
    place.conflicted ||
    [...new Set(place.evidence.map((e) => e.requirementId))].some(
      (id) => consensusFor(place.evidence.filter((e) => e.requirementId === id)) === "conflicted",
    );
  const lift = 1 - enter;
  const style: CSSProperties = {
    position: "relative",
    width,
    height,
    opacity: Math.min(1, enter * 1.4),
    transform: `translateY(${lift * 22}px) scale(${0.97 + 0.03 * enter})`,
  };
  const medalT = Math.min(1, Math.max(0, (enter - 0.35) / 0.65));

  return (
    <div style={style}>
      <Card
        tone={conflicted ? "warn" : "default"}
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          boxShadow:
            highlight > 0
              ? `0 0 0 ${2 * highlight}px rgb(${theme.brandRgb} / ${0.7 * highlight}), ${theme.shadowRaised}`
              : theme.shadowCard,
        }}
      >
        {medalT > 0 ? <RankMedal rank={rank} pop={outBack(2)(medalT)} grow={medalT} /> : null}
        <div style={{ display: "flex", gap: 12, padding: "24px 16px 16px", height: "100%" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, flexShrink: 0 }}>
            <PlacePhoto name={place.name} photo={photoRef(scenario, place.name, place.photo)} />
            {percent !== undefined ? (
              <MatchPill percent={percent}>{t("dossier.score.match", { percent })}</MatchPill>
            ) : null}
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{
                fontSize: 16,
                lineHeight: "20px",
                fontWeight: 600,
                color: theme.fg,
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {place.name}
            </div>
            {place.address ? (
              <div
                style={{
                  marginTop: 2,
                  fontSize: 14,
                  lineHeight: "20px",
                  color: theme.fgMuted,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {place.address}
              </div>
            ) : null}
            <div
              style={{
                marginTop: 4,
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 12,
                lineHeight: "16px",
                letterSpacing: "0.05em",
                textTransform: "uppercase",
                color: theme.fgSubtle,
                whiteSpace: "nowrap",
                overflow: "hidden",
              }}
            >
              {place.category ? (
                <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{place.category}</span>
              ) : null}
              {conflicted ? <Badge tone="warn">{t("dossier.consensus.conflicted")}</Badge> : null}
            </div>
            <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 4 }}>
              {marks.map((mark) => (
                <Badge key={mark.requirementId} tone={mark.tone}>
                  <span style={{ maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis" }}>
                    {requirementLabel(mark.requirementId, scenario.locale)}
                  </span>
                  <span style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                    {mark.percent === undefined ? t("dossier.place.markUnknown") : `${mark.percent}%`}
                  </span>
                </Badge>
              ))}
            </div>
          </div>
          <span style={{ alignSelf: "center", color: theme.fgSubtle }}>
            <ChevronIcon size={16} />
          </span>
        </div>
      </Card>
    </div>
  );
}
