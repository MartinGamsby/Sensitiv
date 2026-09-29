import type { CSSProperties, ReactNode } from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { RUN_PHASES, disclaimerFor } from "@sensitiv/shared";
import { isValidRequirementId } from "@sensitiv/shared/catalog/index";
import { useVideo } from "../../context.tsx";
import { AppHeader } from "../../components/AppHeader.tsx";
import {
  AlertIcon,
  CheckIcon,
  ChevronIcon,
  ClockIcon,
  CrosshairIcon,
  InfoIcon,
  ListIcon,
  MapIcon,
  PinIcon,
  SearchIcon,
} from "../../components/icons.tsx";
import { Badge, Card, LiveDot } from "../../components/ui.tsx";
import { MONO_STACK } from "../../fonts.ts";
import {
  latestMessage,
  latestProgress,
  progressFractionAt,
} from "../../lib/agent-story.ts";
import { lerp } from "../../lib/anim.ts";
import { formatElapsed, requirementLabel, sourceLabel } from "../../lib/copy.ts";
import { runLayout, type Rect } from "../../lib/layout.ts";
import { dossierNotices } from "../../lib/marks.ts";
import { DetailOverlay } from "./DetailOverlay.tsx";
import { PlaceCard } from "./PlaceCard.tsx";
import { ResultsMap } from "./ResultsMap.tsx";

function At({ r, style, children }: { r: Rect; style?: CSSProperties; children?: ReactNode }) {
  return (
    <div style={{ position: "absolute", left: r.x, top: r.y, width: r.width, height: r.height, ...style }}>
      {children}
    </div>
  );
}

function languageName(code: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** `roundRemaining` from the run page: 10 s buckets, then whole minutes. */
function roundRemaining(seconds: number): { value: number; unit: "Sec" | "Min" } {
  if (seconds < 90) return { value: Math.max(10, Math.round(seconds / 10) * 10), unit: "Sec" };
  return { value: Math.max(2, Math.round(seconds / 60)), unit: "Min" };
}

/**
 * The run page (`RunView`) for the imported run: the brief, the status card
 * while it researches, then the dossier — list, place detail, map.
 */
export function RunPage({ f }: { f: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { chor, scenario, theme, t } = useVideo();
  const run = scenario.run;
  const notices = dossierNotices(run);
  const L = runLayout(notices.length);
  const scroll = chor.runScroll(f);

  const runSec = Math.min(chor.run.runSeconds(f), run.durationSec);
  const done = chor.run.done(f);
  const dossier = chor.run.dossier(f);
  const mapView = chor.run.mapView(f);
  const detail = chor.run.detail(f);

  const statusH = lerp(L.statusOpen.height, L.statusClosed.height, done);
  const running = theme.status.running;
  const finished = theme.status.done;
  const mix = (a: string, b: string) => (done < 0.5 ? a : b);

  const progress = latestProgress(run, runSec);
  const fraction = done > 0 ? lerp(Math.min(0.97, progressFractionAt(run, runSec)), 1, done) : Math.min(0.97, progressFractionAt(run, runSec));
  const phase = progress?.progress.phase ?? "start";
  const step = RUN_PHASES.indexOf(phase) + 1;
  const sub =
    progress && (progress.progress.total ?? 0) > 1
      ? t(`run.progress.within.${progress.progress.unit ?? "source"}`, {
          done: Math.min(progress.progress.done ?? 0, progress.progress.total ?? 0),
          total: progress.progress.total ?? 0,
        })
      : undefined;
  const remaining = roundRemaining(Math.max(0, run.durationSec - runSec));
  const timing =
    run.durationSec - runSec < 3
      ? t("run.progress.almostDone", { elapsed: formatElapsed(runSec) })
      : t(`run.progress.remaining${remaining.unit}`, { elapsed: formatElapsed(runSec), value: remaining.value });
  const latest = latestMessage(run, runSec);

  const chips = run.requirements.filter((r) => isValidRequirementId(r.id));
  const created = new Date(run.createdAt);
  const pinned = run.location.pinned && run.location.lat !== undefined && run.location.lng !== undefined;
  const count = Math.min(scenario.visiblePlaces, run.places.length);
  const spotlight = Math.min(scenario.spotlight, run.places.length) - 1;
  const hoverSpotlight = chor.run.hoverCard(f);

  const metaItem = (icon: ReactNode, children: ReactNode) => (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span style={{ color: theme.fgSubtle }}>{icon}</span>
      {children}
    </span>
  );

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <div style={{ position: "absolute", left: 0, top: -scroll, width: 1280, height: 2000 }}>
        {/* --- the brief --------------------------------------------------- */}
        <At r={L.title} style={{ fontSize: 24, lineHeight: "32px", fontWeight: 600, letterSpacing: "-0.01em", color: theme.fg }}>
          {run.request || run.location.query}
        </At>
        <At r={L.newSearch} style={{ display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 500, color: theme.fgMuted }}>
          {t("run.backToForm")}
        </At>
        <At r={L.badges} style={{ display: "flex", gap: 6 }}>
          {chips.map((r) => (
            <Badge key={r.id} tone="brand">
              {requirementLabel(r.id, scenario.locale)}
            </Badge>
          ))}
        </At>
        <At r={L.meta} style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 12, color: theme.fgMuted, whiteSpace: "nowrap" }}>
          {metaItem(<PinIcon size={14} />, <span style={{ fontWeight: 500, color: theme.fg }}>{run.location.query}</span>)}
          {metaItem(<MapIcon size={14} />, t("run.brief.radius", { km: run.location.radiusKm }))}
          {pinned
            ? metaItem(
                <CrosshairIcon size={14} />,
                t("run.brief.pinned", {
                  coords: `${run.location.lat!.toFixed(4)}, ${run.location.lng!.toFixed(4)}`,
                }),
              )
            : null}
          {metaItem(<SearchIcon size={14} />, t("run.brief.searchedIn", { lang: languageName(run.searchLang, scenario.locale) }))}
          {metaItem(
            <ClockIcon size={14} />,
            new Intl.DateTimeFormat(scenario.locale, { dateStyle: "medium", timeStyle: "short" }).format(created),
          )}
        </At>

        {/* --- status ----------------------------------------------------------- */}
        <div
          style={{
            position: "absolute",
            left: L.statusOpen.x,
            top: L.statusOpen.y,
            width: L.statusOpen.width,
            height: statusH,
            overflow: "hidden",
            borderRadius: 12,
            border: `1px solid ${mix(running.border, finished.border)}`,
            background: mix(running.bg, finished.bg),
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 12,
              padding: done > 0.5 ? "10px 16px" : "16px 16px 8px",
            }}
          >
            {done < 0.5 ? (
              <LiveDot color={running.accent} />
            ) : (
              <span style={{ color: finished.accent }}>
                <CheckIcon size={20} />
              </span>
            )}
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", fontSize: 14, lineHeight: "20px", fontWeight: 600, color: mix(running.accent, finished.accent) }}>
                {done < 0.5 ? t("run.status.running") : t("run.status.done")}
                {done >= 0.5 ? (
                  <span style={{ fontWeight: 400, color: theme.fgMuted }}>
                    {" · "}
                    {t("run.progress.took", { elapsed: formatElapsed(run.durationSec) })}
                  </span>
                ) : null}
              </span>
              {done < 0.5 ? (
                <span style={{ display: "block", marginTop: 2, fontSize: 14, lineHeight: "22px", color: theme.fgMuted }}>
                  {t("run.status.runningNote")}
                </span>
              ) : null}
            </span>
            <span style={{ color: theme.fgSubtle, transform: done < 0.5 ? "rotate(90deg)" : undefined }}>
              <ChevronIcon size={16} />
            </span>
          </div>
          {done < 0.5 ? (
            <div style={{ padding: "0 16px 16px 48px", opacity: 1 - done * 2 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: theme.fgMuted }}>
                <span style={{ fontWeight: 500 }}>
                  {t("run.progress.step", { step, total: RUN_PHASES.length, phase: t(`run.progress.phase.${phase}`) })}
                  {sub ? <span style={{ fontWeight: 400, color: theme.fgSubtle }}> · {sub}</span> : null}
                </span>
                <span style={{ fontVariantNumeric: "tabular-nums", color: theme.fgSubtle }}>{timing}</span>
              </div>
              <div style={{ marginTop: 6, height: 6, borderRadius: 999, background: theme.borderSubtle, overflow: "hidden" }}>
                <div style={{ width: `${fraction * 100}%`, height: "100%", borderRadius: 999, background: theme.brand }} />
              </div>
              {latest ? (
                <div
                  style={{
                    marginTop: 8,
                    fontFamily: MONO_STACK,
                    fontSize: 12,
                    lineHeight: "16px",
                    color: theme.fgSubtle,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {latest}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* --- while it works: the placeholder ---------------------------------- */}
        {dossier < 1 ? (
          <At
            r={{ ...L.placeholder, y: L.statusOpen.y + statusH + 24 }}
            style={{ opacity: 1 - dossier }}
          >
            <Card style={{ width: "100%", height: "100%", padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 500, color: theme.fgMuted }}>
                <SearchIcon size={16} />
                {t("run.working")}
              </div>
              {[0, 1, 2].map((i) => {
                const pulse = 0.55 + 0.45 * Math.abs(Math.sin((frame / fps) * Math.PI * 0.9 + i * 0.4));
                return (
                  <div
                    key={i}
                    style={{
                      borderRadius: 12,
                      border: `1px solid ${theme.borderSubtle}`,
                      background: theme.surfaceMuted,
                      padding: 16,
                      opacity: pulse,
                    }}
                  >
                    <div style={{ height: 16, width: "33%", borderRadius: 4, background: theme.borderSubtle }} />
                    <div style={{ marginTop: 12, height: 12, width: "66%", borderRadius: 4, background: theme.borderSubtle }} />
                    <div style={{ marginTop: 8, height: 12, width: "50%", borderRadius: 4, background: theme.borderSubtle }} />
                  </div>
                );
              })}
            </Card>
          </At>
        ) : null}

        {/* --- the dossier ---------------------------------------------------------- */}
        {dossier > 0 ? (
          <div style={{ opacity: dossier, transform: `translateY(${(1 - dossier) * 16}px)` }}>
            <At r={L.dossierHeading} style={{ fontSize: 18, lineHeight: "28px", fontWeight: 600, color: theme.fg }}>
              {t("dossier.title")}
            </At>
            <At r={L.dossierSummary} style={{ fontSize: 14, color: theme.fgMuted }}>
              {t("dossier.summary", { count: run.places.length })}
            </At>
            {notices.map((notice, i) => (
              <At key={notice.kind} r={L.notices[i]!}>
                <Card tone="warn" style={{ width: "100%", height: "100%", padding: 12, display: "flex", gap: 12 }}>
                  <AlertIcon size={16} color={theme.name === "dark" ? "#fcd34d" : "#b45309"} style={{ marginTop: 2 }} />
                  <div style={{ fontSize: 14, lineHeight: "20px", color: theme.name === "dark" ? "#fef3c7" : "#78350f" }}>
                    <div style={{ fontWeight: 600 }}>{t(`dossier.${notice.kind}.title`)}</div>
                    <div>{t(`dossier.${notice.kind}.body`, { sources: notice.sources.map(sourceLabel).join(", ") })}</div>
                  </div>
                </Card>
              </At>
            ))}
            <At r={L.disclaimer} style={{ display: "flex", gap: 6, fontSize: 12, lineHeight: "18px", color: theme.fgMuted }}>
              <InfoIcon size={14} color={theme.fgSubtle} style={{ marginTop: 2 }} />
              {disclaimerFor(scenario.locale)}
            </At>
            <At r={L.sortRow} style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 12, color: theme.fgSubtle }}>{t("dossier.sort.count", { count: run.places.length })}</span>
            </At>
            <At
              r={L.viewSwitch}
              style={{ display: "flex", gap: 2, padding: 2, borderRadius: 8, background: theme.surfaceMuted }}
            >
              {(["list", "map"] as const).map((v) => {
                const on = v === "map" ? mapView >= 0.5 : mapView < 0.5;
                return (
                  <span
                    key={v}
                    style={{
                      flex: 1,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 5,
                      borderRadius: 6,
                      fontSize: 12,
                      fontWeight: 500,
                      background: on ? theme.surface : "transparent",
                      color: on ? theme.fg : theme.fgMuted,
                      boxShadow: on ? theme.shadowCard : undefined,
                    }}
                  >
                    {v === "list" ? <ListIcon size={14} /> : <MapIcon size={14} />}
                    {t(`dossier.view.${v}`)}
                  </span>
                );
              })}
            </At>
            <At
              r={{ x: L.viewSwitch.x + L.viewSwitch.width + 12, y: L.sortRow.y, width: 190, height: 32 }}
              style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: theme.fgMuted }}
            >
              {t("dossier.sort.label")}
              <span
                style={{
                  flex: 1,
                  height: 32,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "0 10px",
                  borderRadius: 8,
                  border: `1px solid ${theme.borderStrong}`,
                  background: theme.surface,
                  color: theme.fg,
                }}
              >
                {t("dossier.sort.recommended")}
                <ChevronIcon size={12} style={{ transform: "rotate(90deg)" }} />
              </span>
            </At>

            {/* List view. */}
            {mapView < 1
              ? run.places.slice(0, count).map((place, i) => {
                  const r = L.card(i);
                  return (
                    <At key={place.name + i} r={r} style={{ opacity: 1 - mapView }}>
                      <PlaceCard
                        place={place}
                        rank={i + 1}
                        enter={chor.run.cardIn(f, i)}
                        width={r.width}
                        height={r.height}
                        highlight={i === spotlight ? hoverSpotlight : 0}
                      />
                    </At>
                  );
                })
              : null}

            {/* Map view. */}
            {mapView > 0 ? (
              <>
                <At
                  r={L.resultsMap}
                  style={{
                    opacity: mapView,
                    borderRadius: 12,
                    overflow: "hidden",
                    border: `1px solid ${theme.borderSubtle}`,
                  }}
                >
                  <ResultsMap f={f} />
                </At>
                {run.places.slice(0, count).map((place, i) => {
                  const r = L.mapCard(i);
                  return (
                    <At key={`m-${place.name}-${i}`} r={r} style={{ opacity: mapView }}>
                      <PlaceCard place={place} rank={i + 1} enter={1} width={r.width} height={r.height} />
                    </At>
                  );
                })}
              </>
            ) : null}
          </div>
        ) : null}
      </div>
      <AppHeader active="history" />
      <DetailOverlay open={detail} highlight={chor.run.highlight(f)} scroll={chor.run.detailScroll(f)} />
    </div>
  );
}
