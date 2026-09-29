import { useMemo, type ReactNode } from "react";
import { useVideo } from "../../context.tsx";
import {
  BookIcon,
  CheckIcon,
  GlobeIcon,
  MapIcon,
  QuoteIcon,
  SearchIcon,
} from "../../components/icons.tsx";
import { LiveDot, Spinner } from "../../components/ui.tsx";
import { MONO_STACK } from "../../fonts.ts";
import { agentStory } from "../../lib/agent-story.ts";
import { clamp, glide } from "../../lib/anim.ts";
import { formatElapsed, requirementLabel, sourceLabel } from "../../lib/copy.ts";
import { parseTagQuote } from "../../lib/marks.ts";

/**
 * "The agent at work": beside the run page while it researches, what the run
 * was actually doing — its plan, its sources, the pages it opened and the
 * quote that ended up deciding the top result. Everything is read from the
 * run's own log (`agentStory`) and played back on the run's own clock.
 *
 * The panel's shape is there from the first frame, as placeholders; the run
 * fills it in. An empty box that grows would read as nothing happening.
 */
export function AgentPanel({ f }: { f: number }) {
  const { chor, scenario, theme, width, height, t } = useVideo();
  const run = scenario.run;
  const A = scenario.copy.agent;
  const spotlightIndex = Math.min(scenario.spotlight, run.places.length) - 1;
  const story = useMemo(
    () => agentStory(run, { spotlightIndex, requirementId: scenario.search.requirement }),
    [run, spotlightIndex, scenario.search.requirement],
  );

  const shown = chor.agent(f);
  if (shown <= 0) return null;
  const sec = chor.run.runSeconds(f);
  const clock = Math.min(sec, run.durationSec);
  const u = height / 1080;
  const s = (n: number) => n * u;
  const n = (text: string, count: number) => text.replace("{n}", String(count));
  /** 0..1 over `over` run-seconds after `at`; 0 when `at` is unknown. */
  const since = (at: number | undefined, over = 1.5) =>
    at === undefined ? 0 : clamp((sec - at) / over);

  const dark = theme.name === "dark";
  const rowBg = dark ? "rgb(255 255 255 / 0.035)" : "rgb(15 23 42 / 0.035)";
  const ghost = dark ? "rgb(255 255 255 / 0.07)" : "rgb(15 23 42 / 0.07)";
  const bar = (w: string, h = 12) => (
    <span style={{ display: "block", width: w, height: s(h), borderRadius: s(6), background: ghost }} />
  );
  /**
   * Crossfades a placeholder into the real content as `k` goes 0 → 1. The
   * content stays in flow (invisible at first) so the panel never changes
   * size; the placeholder sits over it.
   */
  const fill = (k: number, placeholder: ReactNode, content: ReactNode) => (
    <div style={{ position: "relative" }}>
      <div style={{ opacity: k, transform: `translateY(${(1 - glide(k)) * s(8)}px)` }}>{content}</div>
      {k < 1 ? (
        <div style={{ position: "absolute", left: 0, right: 0, top: 0, opacity: 1 - k }}>{placeholder}</div>
      ) : null}
    </div>
  );

  const label = (text: string, active: number, right?: ReactNode) => (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "baseline",
        marginBottom: s(10),
        fontSize: s(13),
        fontWeight: 600,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color: theme.fgSubtle,
        opacity: 0.55 + 0.45 * active,
      }}
    >
      <span>{text}</span>
      {right ? <span style={{ letterSpacing: 0, textTransform: "none", fontWeight: 500 }}>{right}</span> : null}
    </div>
  );

  const chip = (children: ReactNode, key: string) => (
    <span
      key={key}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: s(6),
        height: s(32),
        padding: `0 ${s(12)}px`,
        borderRadius: 999,
        background: theme.brandSoft,
        color: theme.brandSoftFg,
        fontSize: s(16),
        fontWeight: 500,
      }}
    >
      {children}
    </span>
  );

  // --- plan ------------------------------------------------------------------------
  const planned = since(story.plannedAt ?? 0.5, 1.2);
  const query = story.queries[0];
  const plan = fill(
    planned,
    <div style={{ display: "flex", flexDirection: "column", gap: s(12) }}>
      <div style={{ display: "flex", gap: s(8), height: s(32), alignItems: "center" }}>
        {bar(`${s(110)}px`, 30)}
        {bar(`${s(190)}px`, 30)}
      </div>
      {bar("60%", 16)}
    </div>,
    <div style={{ display: "flex", flexDirection: "column", gap: s(10) }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: s(8) }}>
        {run.requirements.map((r) =>
          chip(
            <>
              {requirementLabel(r.id, scenario.locale)}
              <span style={{ opacity: 0.7, fontVariantNumeric: "tabular-nums" }}>×{r.weight}</span>
            </>,
            r.id,
          ),
        )}
      </div>
      {query ? (
        <div
          style={{
            opacity: since(query.at, 1),
            display: "flex",
            alignItems: "center",
            gap: s(10),
            height: s(22),
            fontSize: s(17),
            color: theme.fg,
          }}
        >
          <SearchIcon size={s(18)} color={theme.fgSubtle} />
          <span style={{ fontStyle: "italic" }}>“{query.text}”</span>
        </div>
      ) : null}
    </div>,
  );

  // --- sources ------------------------------------------------------------------------
  const maps = story.maps;
  const osm = story.osm;
  const mapsEnd = story.readingEndsAt ?? maps?.searchedAt ?? run.durationSec;
  const working = (text: string) => (
    <span style={{ display: "inline-flex", alignItems: "center", gap: s(6) }}>
      <Spinner size={s(14)} /> {text}
    </span>
  );
  const sourceRow = (icon: ReactNode, name: string, status: ReactNode, progress: number) => (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: s(8),
        padding: `${s(12)}px ${s(14)}px`,
        borderRadius: s(12),
        background: rowBg,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: s(10), height: s(22), fontSize: s(17) }}>
        <span style={{ color: progress > 0 ? theme.brand : theme.fgSubtle }}>{icon}</span>
        <span style={{ fontWeight: 600, color: theme.fg }}>{name}</span>
        <span style={{ marginLeft: "auto", color: theme.fgMuted, fontSize: s(15) }}>{status}</span>
      </div>
      <div style={{ height: s(4), borderRadius: 999, background: ghost }}>
        <div style={{ width: `${clamp(progress) * 100}%`, height: "100%", borderRadius: 999, background: theme.brand }} />
      </div>
    </div>
  );
  const readingDone = story.opened.filter((o) => (o.doneAt ?? Infinity) <= sec).length;
  const mapsStatus = !maps
    ? null
    : sec < maps.startedAt
      ? "—"
      : story.opened.length > 0 && story.opened[0]!.at <= sec
        ? t("run.progress.within.place", { done: readingDone, total: story.opened.length })
        : maps.scanned !== undefined && maps.scannedAt !== undefined && sec >= maps.scannedAt
          ? n(A.scanned, maps.scanned)
          : working(A.searching);
  const osmStart = osm?.startedAt ?? (osm ? osm.at - 1 : 0);
  const osmStatus = !osm ? null : sec < osmStart ? "—" : sec >= osm.at ? n(A.tagged, osm.tagged) : working(A.querying);

  // --- reading ---------------------------------------------------------------------------
  const ROWS = 4;
  const openedNow = story.opened.filter((o) => o.at <= sec);
  const rows = openedNow.slice(-ROWS);

  // --- the quote -----------------------------------------------------------------------
  const spot = story.spotlight;
  const quoteIn = since(spot?.at, 3);
  const tag = spot ? parseTagQuote(spot.evidence.quote) : undefined;

  // --- result ---------------------------------------------------------------------------
  const finished = story.finished;
  const doneIn = since(finished?.at ?? run.durationSec, 0.8);

  const panelW = s(660);
  const x = width - panelW - s(64) + (1 - glide(shown)) * s(60);

  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: "50%",
        transform: "translateY(-52%)",
        width: panelW,
        opacity: shown,
        display: "flex",
        flexDirection: "column",
        gap: s(22),
        padding: s(28),
        borderRadius: s(24),
        background: dark ? "rgb(13 19 34 / 0.9)" : "rgb(255 255 255 / 0.92)",
        border: `1px solid ${theme.glassBorder}`,
        boxShadow: `0 ${s(30)}px ${s(80)}px -${s(20)}px rgb(0 0 0 / 0.6)`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: s(12) }}>
        <LiveDot color={doneIn >= 1 ? theme.positive : theme.brand} />
        <span style={{ fontSize: s(22), fontWeight: 650, color: theme.fg, letterSpacing: "-0.01em" }}>
          {doneIn >= 1 ? A.complete : A.working}
        </span>
        <span
          style={{
            marginLeft: "auto",
            fontFamily: MONO_STACK,
            fontSize: s(15),
            color: theme.fgSubtle,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {formatElapsed(clock)} / {formatElapsed(run.durationSec)} · {A.spedUp}
        </span>
      </div>

      <div>
        {label(A.plan, planned)}
        {plan}
      </div>

      <div>
        {label(A.sources, since(Math.min(maps?.startedAt ?? Infinity, osmStart || Infinity), 1))}
        <div style={{ display: "flex", flexDirection: "column", gap: s(8) }}>
          {maps
            ? sourceRow(
                <MapIcon size={s(18)} />,
                sourceLabel("google_maps"),
                mapsStatus,
                (sec - maps.startedAt) / Math.max(1, mapsEnd - maps.startedAt),
              )
            : null}
          {osm
            ? sourceRow(
                <GlobeIcon size={s(18)} />,
                sourceLabel("openstreetmap"),
                osmStatus,
                (sec - osmStart) / Math.max(0.5, osm.at - osmStart),
              )
            : null}
        </div>
      </div>

      {story.opened.length > 0 ? (
        <div>
          {label(A.reading, since(story.opened[0]?.at, 1))}
          <div style={{ display: "flex", flexDirection: "column", gap: s(6) }}>
            {Array.from({ length: ROWS }, (_, i) => {
              const o = rows[i];
              if (!o) {
                return (
                  <div key={`ghost-${i}`} style={{ height: s(32), display: "flex", alignItems: "center", gap: s(10) }}>
                    {bar(`${s(16)}px`, 16)}
                    {bar(`${s(150 + ((i * 53) % 90))}px`, 12)}
                  </div>
                );
              }
              const k = since(o.at, 0.8);
              const doneRow = o.doneAt !== undefined && o.doneAt <= sec;
              return (
                <div
                  key={o.name}
                  style={{
                    opacity: k,
                    transform: `translateY(${(1 - k) * s(10)}px)`,
                    display: "flex",
                    alignItems: "center",
                    gap: s(10),
                    height: s(32),
                    fontSize: s(16),
                    color: theme.fg,
                  }}
                >
                  <span style={{ color: theme.fgSubtle }}>
                    <BookIcon size={s(16)} />
                  </span>
                  <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{o.name}</span>
                  <span style={{ marginLeft: "auto", flexShrink: 0, fontSize: s(14), color: theme.fgMuted }}>
                    {!doneRow ? (
                      <Spinner size={s(14)} color={theme.fgSubtle} />
                    ) : o.added > 0 ? (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: s(4), color: theme.positive }}>
                        <CheckIcon size={s(14)} />
                        {n(A.found, o.added)}
                      </span>
                    ) : (
                      A.nothing
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {spot ? (
        <div>
          {label(A.evidence, quoteIn)}
          <div
            style={{
              padding: `${s(16)}px ${s(18)}px`,
              borderRadius: s(14),
              borderLeft: `${s(3)}px solid ${quoteIn > 0 ? theme.positive : ghost}`,
              background: rowBg,
            }}
          >
            {fill(
              quoteIn,
              <div style={{ display: "flex", flexDirection: "column", gap: s(10), paddingTop: s(6) }}>
                {bar("92%", 16)}
                {bar("64%", 16)}
                {bar("40%", 12)}
              </div>,
              <div>
                {tag ? (
                  <code style={{ fontFamily: MONO_STACK, fontSize: s(18), color: theme.fg }}>
                    {tag.key} = {tag.value}
                  </code>
                ) : (
                  <div style={{ display: "flex", gap: s(10), fontSize: s(21), lineHeight: 1.4, fontStyle: "italic", color: theme.fg }}>
                    <QuoteIcon size={s(20)} color={theme.fgSubtle} style={{ marginTop: s(4) }} />
                    <span
                      style={{
                        backgroundImage: `linear-gradient(90deg, rgb(${theme.brandRgb} / 0.3), rgb(${theme.brandRgb} / 0.3))`,
                        backgroundRepeat: "no-repeat",
                        backgroundSize: `${clamp((quoteIn - 0.35) / 0.65) * 100}% 100%`,
                        boxDecorationBreak: "clone",
                        WebkitBoxDecorationBreak: "clone",
                        borderRadius: s(4),
                      }}
                    >
                      “{spot.evidence.quote}”
                    </span>
                  </div>
                )}
                <div style={{ marginTop: s(12), display: "flex", alignItems: "center", gap: s(10), fontSize: s(15), color: theme.fgMuted }}>
                  <span style={{ color: theme.positive, fontWeight: 600 }}>{t(`dossier.evidence.${spot.evidence.polarity}`)}</span>
                  <span>·</span>
                  <span>{requirementLabel(spot.evidence.requirementId, scenario.locale)}</span>
                  <span style={{ marginLeft: "auto", color: theme.fgSubtle, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {sourceLabel(spot.evidence.source)} · {spot.place}
                  </span>
                </div>
              </div>,
            )}
          </div>
        </div>
      ) : null}

      {finished ? (
        <div>
          {label(A.result, doneIn)}
          <div style={{ display: "flex", gap: s(12) }}>
            {(
              [
                [finished.places, A.placesRanked],
                [finished.evidence, A.evidenceItems],
                [finished.conflicted, A.conflicts],
              ] as const
            ).map(([count, text]) => (
              <div key={text} style={{ flex: 1, padding: `${s(12)}px ${s(14)}px`, borderRadius: s(12), background: rowBg }}>
                <div style={{ fontSize: s(30), lineHeight: 1.2, fontWeight: 700, color: doneIn > 0 ? theme.fg : theme.fgSubtle, fontVariantNumeric: "tabular-nums" }}>
                  {doneIn > 0 ? Math.round(count * glide(doneIn)) : "—"}
                </div>
                <div style={{ fontSize: s(14), color: theme.fgMuted }}>{text}</div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
