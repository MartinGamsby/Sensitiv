import type { ReactNode } from "react";
import { disclaimerFor } from "@sensitiv/shared";
import { useVideo } from "../../context.tsx";
import {
  CloseIcon,
  ExternalIcon,
  InfoIcon,
  PinIcon,
  QuoteIcon,
  SearchIcon,
} from "../../components/icons.tsx";
import { Badge, MatchPill, PlacePhoto } from "../../components/ui.tsx";
import type { SnapshotEvidence } from "../../config/run-snapshot.ts";
import { spotlightEvidence } from "../../lib/agent-story.ts";
import { glide } from "../../lib/anim.ts";
import { photoRef } from "../../lib/assets.ts";
import { requirementLabel, sourceLabel } from "../../lib/copy.ts";
import { DETAIL, VIEWPORT } from "../../lib/layout.ts";
import {
  consensusFor,
  evidenceFor,
  formatDelta,
  groupByRequirement,
  parseTagQuote,
  placeDistanceKm,
  placePercent,
} from "../../lib/marks.ts";

/** How far the dialog's content scrolls to bring the evidence into view. */
export const DETAIL_SCROLL = 52;

/**
 * The place-detail overlay (`PlaceDetailOverlay` + `PlaceDetailBody`) for the
 * spotlight place: how the score was worked out, where it came from, and the
 * quotes behind it. `open` fades and lifts it in; `highlight` sweeps a marker
 * over the key quote.
 */
export function DetailOverlay({
  open,
  highlight,
  scroll,
}: {
  open: number;
  highlight: number;
  /** 0..1 — the dialog scrolled down to its evidence. */
  scroll: number;
}) {
  const { scenario, theme, t } = useVideo();
  if (open <= 0) return null;
  const run = scenario.run;
  const index = Math.min(scenario.spotlight, run.places.length) - 1;
  const place = run.places[index]!;
  const percent = placePercent(run, place);
  const distance = placeDistanceKm(run, place);
  const key = spotlightEvidence(run, index, scenario.search.requirement);
  const e = glide(open);

  // The ticked requirement first, then the rest in the order they were found;
  // within each, what supports it first — the evidence the video is about.
  const groups = groupByRequirement(place.evidence)
    .sort((a, b) =>
      a.requirementId === scenario.search.requirement ? -1 : b.requirementId === scenario.search.requirement ? 1 : 0,
    )
    .map((g) => ({
      ...g,
      evidence: [...g.evidence]
        .filter((ev) => ev.quote.trim() !== "" || ev.polarity !== "unclear")
        .sort((a, b) => rankPolarity(a) - rankPolarity(b) || b.confidence - a.confidence),
    }))
    .filter((g) => g.evidence.length > 0);

  const briefLine = [
    run.request,
    ...run.requirements
      .filter((r) => r.id === scenario.search.requirement)
      .map((r) => requirementLabel(r.id, scenario.locale)),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: VIEWPORT.width,
          height: VIEWPORT.height,
          zIndex: 30,
          // A plain dim rather than a backdrop blur: under the camera's scale
          // transform Chrome's backdrop-filter mirrors content in from the
          // edges, which rendered ghost copies of the cards behind the dialog.
          background: `rgb(${theme.bgRgb} / ${0.78 * e})`,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: DETAIL.x,
          top: DETAIL.y,
          width: DETAIL.width,
          height: DETAIL.height,
          zIndex: 31,
          opacity: e,
          transform: `translateY(${(1 - e) * 18}px) scale(${0.97 + 0.03 * e})`,
          borderRadius: 16,
          border: `1px solid ${theme.borderSubtle}`,
          background: theme.surface,
          boxShadow: "0 24px 60px -12px rgb(0 0 0 / 0.55)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: 20,
            display: "flex",
            flexDirection: "column",
            gap: 14,
            transform: `translateY(${-scroll * DETAIL_SCROLL}px)`,
          }}
        >
          {/* What was asked, and a way out. */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              paddingBottom: 12,
              borderBottom: `1px solid ${theme.borderSubtle}`,
              fontSize: 12,
              color: theme.fgMuted,
            }}
          >
            <SearchIcon size={14} color={theme.fgSubtle} />
            <span style={{ fontWeight: 500, color: theme.fg }}>{briefLine}</span>
            <PinIcon size={12} />
            <span>{run.location.query}</span>
            <span style={{ marginLeft: "auto", color: theme.fgSubtle }}>
              <CloseIcon size={16} />
            </span>
          </div>

          {/* The place. */}
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
            <span
              style={{
                width: 24,
                height: 24,
                marginTop: 16,
                borderRadius: 999,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 12,
                fontWeight: 700,
                background: theme.surfaceMuted,
                color: theme.fgMuted,
              }}
            >
              {index + 1}
            </span>
            <PlacePhoto name={place.name} photo={photoRef(scenario, place.name, place.photo)} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 18, lineHeight: "24px", fontWeight: 600, color: theme.fg }}>{place.name}</div>
              {place.address ? (
                <div style={{ fontSize: 14, lineHeight: "20px", color: theme.fgMuted }}>{place.address}</div>
              ) : null}
              {place.category ? (
                <div style={{ marginTop: 2, fontSize: 12, letterSpacing: "0.05em", textTransform: "uppercase", color: theme.fgSubtle }}>
                  {place.category}
                </div>
              ) : null}
            </div>
            {percent !== undefined ? (
              <MatchPill percent={percent} size="md">
                {t("dossier.score.match", { percent })}
              </MatchPill>
            ) : null}
          </div>

          {/* How the score was worked out. */}
          <div
            style={{
              borderRadius: 10,
              border: `1px solid ${theme.borderSubtle}`,
              background: theme.surfaceMuted,
              padding: 12,
              fontSize: 12,
            }}
          >
            <div style={{ fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", color: theme.fgSubtle }}>
              {t("dossier.score.explain")}
            </div>
            <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
              {place.breakdown.map((line, i) => {
                const subject =
                  line.rule === "proximity"
                    ? t("dossier.score.distance")
                    : requirementLabel(line.requirementId, scenario.locale);
                const detail =
                  line.rule === "proximity" && distance !== undefined
                    ? t("dossier.score.distanceFrom", { km: distance })
                    : t(`dossier.score.rule.${line.rule}`);
                const said = evidenceFor(place.evidence, line);
                return (
                  <div key={i} style={{ display: "flex", gap: 8, lineHeight: "17px" }}>
                    <span
                      style={{
                        width: 44,
                        flexShrink: 0,
                        textAlign: "right",
                        fontWeight: 600,
                        fontVariantNumeric: "tabular-nums",
                        color: line.delta > 0 ? theme.positive : line.delta < 0 ? theme.negative : theme.fgSubtle,
                      }}
                    >
                      {formatDelta(line.delta)}
                    </span>
                    <span style={{ minWidth: 0 }}>
                      <span style={{ fontWeight: 500, color: theme.fg }}>{subject}</span>
                      {line.rule !== "proximity" && line.weight !== 1 ? (
                        <span style={{ color: theme.fgSubtle }}> {t("dossier.score.weight", { weight: line.weight })}</span>
                      ) : null}
                      <span style={{ display: "block", color: theme.fgMuted }}>{said.claim ?? detail}</span>
                      {said.sources.length > 0 ? (
                        <span style={{ display: "block", color: theme.fgSubtle }}>
                          {t("dossier.score.sourceCount", { count: said.sources.length })} ·{" "}
                          {said.sources.map(sourceLabel).join(", ")}
                        </span>
                      ) : line.viaCategory ? (
                        <span style={{ display: "block", color: theme.fgSubtle }}>
                          {place.category
                            ? t("dossier.score.viaCategoryNamed", { category: place.category })
                            : t("dossier.score.viaCategory")}
                        </span>
                      ) : null}
                    </span>
                  </div>
                );
              })}
            </div>
            <div
              style={{
                marginTop: 8,
                paddingTop: 8,
                borderTop: `1px solid ${theme.borderSubtle}`,
                color: theme.fgMuted,
              }}
            >
              {t("dossier.score.total", {
                score: formatDelta(place.score),
                max: Math.round(run.maxScore * 10) / 10,
              })}
            </div>
          </div>

          {/* Where it came from. */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {place.sources.map((s, i) => (
              <span
                key={i}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  borderRadius: 999,
                  border: `1px solid ${theme.borderSubtle}`,
                  padding: "2px 10px",
                  fontSize: 12,
                  color: theme.fgMuted,
                }}
              >
                {sourceLabel(s.source)}
                {s.rating !== undefined ? ` · ${t("dossier.place.rating", { rating: s.rating })}` : ""}
                {s.reviewCount !== undefined ? ` · ${t("dossier.place.reviews", { count: s.reviewCount })}` : ""}
                <ExternalIcon size={12} />
              </span>
            ))}
          </div>

          {/* What each source said, per requirement. */}
          <div
            style={{
              borderTop: `1px solid ${theme.borderSubtle}`,
              paddingTop: 12,
              display: "flex",
              flexDirection: "column",
              gap: 12,
              minHeight: 0,
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", color: theme.fgSubtle }}>
              {t("dossier.place.requirementMatch")}
            </div>
            {groups.slice(0, 2).map((g) => {
              const consensus = consensusFor(g.evidence);
              return (
                <div key={g.requirementId} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 14, fontWeight: 500, color: theme.fg }}>
                      {requirementLabel(g.requirementId, scenario.locale)}
                    </span>
                    <Badge tone={consensus === "agreed" ? "ok" : consensus === "conflicted" ? "warn" : "neutral"}>
                      {t(`dossier.consensus.${consensus}`)}
                    </Badge>
                  </div>
                  {g.evidence.slice(0, 1).map((ev, i) => (
                    <EvidenceItem key={i} evidence={ev} highlight={ev === key ? highlight : 0} />
                  ))}
                </div>
              );
            })}
          </div>

          <div style={{ display: "flex", gap: 6, fontSize: 12, color: theme.fgMuted }}>
            <InfoIcon size={14} color={theme.fgSubtle} style={{ marginTop: 1 }} />
            {disclaimerFor(scenario.locale)}
          </div>
        </div>
      </div>
    </>
  );
}

function rankPolarity(e: SnapshotEvidence): number {
  return e.polarity === "supports" ? 0 : e.polarity === "contradicts" ? 1 : 2;
}

function EvidenceItem({ evidence, highlight }: { evidence: SnapshotEvidence; highlight: number }) {
  const { theme, t } = useVideo();
  const tag = parseTagQuote(evidence.quote);
  const rail =
    evidence.polarity === "supports"
      ? theme.name === "dark" ? "#065f46" : "#6ee7b7"
      : evidence.polarity === "contradicts"
        ? theme.name === "dark" ? "#991b1b" : "#fca5a5"
        : theme.borderSubtle;
  const polarityColor =
    evidence.polarity === "supports"
      ? theme.positive
      : evidence.polarity === "contradicts"
        ? theme.negative
        : theme.fgMuted;
  const attribution = evidence.date
    ? t("dossier.evidence.attributionDated", { source: sourceLabel(evidence.source), date: evidence.date })
    : t("dossier.evidence.attribution", { source: sourceLabel(evidence.source) });

  let body: ReactNode = null;
  if (tag) {
    body = (
      <>
        <div style={{ marginTop: 4, fontSize: 14, lineHeight: "22px", color: theme.fg }}>{evidence.claim}</div>
        <div style={{ marginTop: 6, display: "flex", alignItems: "baseline", gap: 6, fontSize: 12 }}>
          <span style={{ color: theme.fgSubtle }}>{t("dossier.evidence.tag")}</span>
          <code
            style={{
              borderRadius: 4,
              border: `1px solid ${theme.borderSubtle}`,
              background: theme.surfaceMuted,
              padding: "2px 6px",
              fontFamily: "inherit",
              color: theme.fgMuted,
            }}
          >
            {tag.key} = {tag.value}
          </code>
        </div>
      </>
    );
  } else if (evidence.quote) {
    body = (
      <div style={{ marginTop: 6, display: "flex", gap: 6, fontSize: 14, lineHeight: "22px", fontStyle: "italic", color: theme.fg }}>
        <QuoteIcon size={14} color={theme.fgSubtle} style={{ marginTop: 3 }} />
        <span
          style={{
            // A highlighter pass over the quote: a brand-tinted band that
            // grows left to right under the text.
            backgroundImage: `linear-gradient(90deg, rgb(${theme.brandRgb} / 0.28), rgb(${theme.brandRgb} / 0.28))`,
            backgroundRepeat: "no-repeat",
            backgroundSize: `${highlight * 100}% 100%`,
            borderRadius: 3,
            padding: "0 2px",
            boxDecorationBreak: "clone",
            WebkitBoxDecorationBreak: "clone",
          }}
        >
          “{evidence.quote}”
        </span>
      </div>
    );
  }

  return (
    <div style={{ borderLeft: `2px solid ${rail}`, paddingLeft: 12 }}>
      <div style={{ fontSize: 12, fontWeight: 500 }}>
        <span style={{ color: polarityColor }}>{t(`dossier.evidence.${evidence.polarity}`)}</span>
        {tag ? null : <span style={{ color: theme.fgMuted }}> · {evidence.claim}</span>}
      </div>
      {body}
      <div style={{ marginTop: 4, fontSize: 12, color: theme.fgSubtle }}>
        {attribution}
        {" · "}
        <span style={{ fontWeight: 500, color: theme.brand }}>{t("dossier.viewSource")}</span>
      </div>
    </div>
  );
}
