import type { CSSProperties, ReactNode } from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { disclaimerFor } from "@sensitiv/shared";
import { getRequirement, labelOf } from "@sensitiv/shared/catalog/index";
import { useVideo } from "../../context.tsx";
import { AppHeader } from "../../components/AppHeader.tsx";
import {
  CheckIcon,
  ChevronIcon,
  ClockIcon,
  CrosshairIcon,
  InfoIcon,
  MapIcon,
  PinIcon,
  REQUIREMENT_ICON,
  SearchIcon,
  SlidersIcon,
} from "../../components/icons.tsx";
import { Card, SectionHeading, Spinner } from "../../components/ui.tsx";
import { formLayout, intentPills, type Rect } from "../../lib/layout.ts";
import { FormMap } from "./FormMap.tsx";

/** Absolutely positioned at a layout rect, in page coordinates. */
function At({ r, style, children }: { r: Rect; style?: CSSProperties; children?: ReactNode }) {
  return (
    <div
      style={{
        position: "absolute",
        left: r.x,
        top: r.y,
        width: r.width,
        height: r.height,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

const PRESETS = ["celiacPlateau", "gfBrunch", "halalAccess", "moldVerdun"] as const;

/**
 * The search form (`RunForm`), as it looks on `/`. Every block sits at the
 * rect `formLayout` gives it, which is where the cursor aims.
 */
export function FormPage({ f }: { f: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { chor, theme, t, scenario, chipIds, intentIds, intentLabels } = useVideo();
  const form = chor.form;

  const mapOpen = form.mapOpen(f);
  const intentRow = form.intentRow(f);
  const L = formLayout({ mapOpen, intentRow });
  const scroll = chor.formScroll(f);
  const map = form.map(f);
  const pinned = map.drop > 0;
  const located = form.located(f);
  const radius = form.radiusKm(f);
  const slider = form.slider(f);
  const typed = form.typed(f);
  const focus = form.textareaFocus(f);
  const submitting = form.submitting(f);
  const chipOn = form.chipOn(f);
  const pulse = form.intentPulse(f);
  const caretOn = Math.floor((frame / fps) * 2) % 2 === 0;

  const inputBox: CSSProperties = {
    borderRadius: 8,
    border: `1px solid ${theme.borderStrong}`,
    background: theme.surface,
    fontSize: 14,
    color: theme.fg,
    display: "flex",
    alignItems: "center",
  };
  const label: CSSProperties = { fontSize: 14, fontWeight: 500, lineHeight: "14px", color: theme.fg };

  const pills = intentPills(L, intentLabels);
  const request = scenario.search.request.slice(0, typed);

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <div style={{ position: "absolute", left: 0, top: -scroll, width: 1280, height: L.pageHeight }}>
        {/* --- title ------------------------------------------------------ */}
        <At r={L.title}>
          <div style={{ fontSize: 30, lineHeight: "36px", fontWeight: 600, letterSpacing: "-0.02em", color: theme.fg }}>
            {t("form.title")}
          </div>
        </At>
        <At r={L.subtitle}>
          <div style={{ fontSize: 16, lineHeight: "26px", color: theme.fgMuted }}>{t("form.subtitle")}</div>
        </At>

        {/* --- 1. where ----------------------------------------------------- */}
        <At r={L.card1}>
          <Card style={{ width: "100%", height: "100%" }} />
        </At>
        <At r={L.heading1}>
          <SectionHeading eyebrow="1">{t("form.steps.where")}</SectionHeading>
        </At>
        <At r={L.locationLabel} style={label}>
          {t("form.location.label")}
        </At>
        <At
          r={L.locationInput}
          style={{
            ...inputBox,
            paddingLeft: 36,
            boxShadow: located > 0 && located < 1 ? `0 0 0 ${3 * (1 - located)}px rgb(${theme.brandRgb} / 0.35)` : undefined,
          }}
        >
          <span style={{ position: "absolute", left: 12, top: 14, color: theme.fgSubtle }}>
            <PinIcon size={16} />
          </span>
          {located > 0 ? (
            <span style={{ opacity: located, color: theme.fg }}>{scenario.search.locationText}</span>
          ) : (
            <span style={{ color: theme.fgSubtle }}>{t("form.location.placeholder")}</span>
          )}
        </At>
        <At
          r={L.useMyLocation}
          style={{ ...inputBox, justifyContent: "center", gap: 8, fontWeight: 500 }}
        >
          <CrosshairIcon size={16} />
          {t("form.useMyLocation")}
        </At>

        <At r={L.radiusLabel} style={{ ...label, display: "flex", alignItems: "center", whiteSpace: "nowrap" }}>
          {t("form.radius.label")}
        </At>
        <At r={L.radiusSlider} style={{ display: "flex", alignItems: "center" }}>
          <div style={{ position: "relative", width: "100%", height: 6, borderRadius: 999, background: theme.borderStrong }}>
            <div
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                bottom: 0,
                width: `${8 + (L.radiusSlider.width - 16) * slider}px`,
                borderRadius: 999,
                background: theme.brand,
              }}
            />
            <div
              style={{
                position: "absolute",
                top: 3,
                left: 8 + (L.radiusSlider.width - 16) * slider,
                width: 18,
                height: 18,
                marginLeft: -9,
                marginTop: -9,
                borderRadius: 999,
                background: theme.brand,
                boxShadow: `0 0 0 3px rgb(${theme.bgRgb} / 0.9), 0 1px 3px rgb(0 0 0 / 0.4)`,
              }}
            />
          </div>
        </At>
        <At
          r={L.radiusInput}
          style={{ ...inputBox, justifyContent: "flex-end", padding: "0 12px", fontVariantNumeric: "tabular-nums" }}
        >
          {radius}
        </At>
        <At r={L.radiusUnit} style={{ display: "flex", alignItems: "center", fontSize: 14, color: theme.fgMuted }}>
          {t("form.radius.unit")}
        </At>
        <At r={L.radiusHint} style={{ fontSize: 12, lineHeight: "16px", color: theme.fgSubtle }}>
          {t("form.radius.hint")}
        </At>
        <div
          style={{
            position: "absolute",
            left: L.heading1.x,
            top: L.divider,
            width: L.heading1.width,
            height: 1,
            background: theme.borderSubtle,
          }}
        />
        <div
          style={{
            position: "absolute",
            left: L.mapButton.x,
            top: L.mapButton.y,
            height: L.mapButton.height,
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "0 12px",
            borderRadius: 8,
            border: `1px solid ${mapOpen > 0.5 ? `rgb(${theme.brandRgb} / 0.4)` : theme.borderStrong}`,
            background: mapOpen > 0.5 ? theme.brandSoft : theme.surface,
            color: mapOpen > 0.5 ? theme.brandSoftFg : theme.fg,
            fontSize: 14,
            fontWeight: 500,
            whiteSpace: "nowrap",
          }}
        >
          <MapIcon size={16} />
          {t("form.map.label")}
          {pinned ? (
            <span style={{ fontSize: 12, fontWeight: 400, opacity: 0.8 * Math.min(1, map.drop * 2) }}>
              · {t("form.map.pinned")}
            </span>
          ) : null}
        </div>
        <At
          r={L.postalLink}
          style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 6, fontSize: 12, color: theme.fgSubtle }}
        >
          <ChevronIcon size={14} />
          {t("form.postal.label")}
        </At>

        {mapOpen > 0 ? (
          <>
            <div
              style={{
                position: "absolute",
                left: L.map.x,
                top: L.map.y,
                width: L.map.width,
                height: L.map.height * mapOpen,
                overflow: "hidden",
                borderRadius: 12,
                border: `1px solid ${theme.borderSubtle}`,
                opacity: Math.min(1, mapOpen * 1.6),
              }}
            >
              <FormMap state={map} />
            </div>
            <At
              r={L.mapHint}
              style={{ fontSize: 12, lineHeight: "16px", color: theme.fgMuted, opacity: mapOpen }}
            >
              {pinned
                ? t("form.map.pinAt", {
                    lat: scenario.search.pin.lat.toFixed(4),
                    lng: scenario.search.pin.lng.toFixed(4),
                  })
                : t("form.map.hint")}
            </At>
          </>
        ) : null}

        {/* --- 2. what has to be true ----------------------------------------- */}
        <At r={L.card2}>
          <Card style={{ width: "100%", height: "100%" }} />
        </At>
        <At r={{ ...L.heading2, height: 60 }}>
          <SectionHeading eyebrow="2" description={t("form.chips.description")}>
            {t("form.chips.label")}
          </SectionHeading>
        </At>
        {chipIds.map((id, i) => {
          const r = L.chips[i];
          if (!r) return null;
          const on = id === scenario.search.requirement ? chipOn : 0;
          const Glyph = REQUIREMENT_ICON[id];
          const chip = (active: boolean): CSSProperties => ({
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "0 12px",
            borderRadius: 12,
            border: `1px solid ${active ? theme.brand : theme.borderSubtle}`,
            background: active ? theme.brandSoft : theme.surface,
            color: active ? theme.brandSoftFg : theme.fg,
            boxShadow: active ? theme.shadowCard : undefined,
            fontSize: 14,
            fontWeight: 500,
          });
          const content = (active: boolean) => (
            <>
              <span style={{ color: active ? theme.brand : theme.fgSubtle }}>
                {Glyph ? <Glyph size={20} /> : null}
              </span>
              <span style={{ lineHeight: 1.2 }}>{labelOf(getRequirement(id), scenario.locale)}</span>
              <span style={{ marginLeft: "auto", color: theme.brand, opacity: active ? 1 : 0 }}>
                <CheckIcon size={16} />
              </span>
            </>
          );
          return (
            <At key={id} r={r}>
              <div style={chip(false)}>{content(false)}</div>
              {on > 0 ? (
                <div style={{ ...chip(true), opacity: on, transform: `scale(${0.97 + 0.03 * on})` }}>
                  {content(true)}
                </div>
              ) : null}
            </At>
          );
        })}
        <At
          r={{ ...L.chipRow, height: 16 }}
          style={{ fontSize: 12, lineHeight: "16px", color: theme.fgSubtle, opacity: 1 - intentRow }}
        >
          {t("form.chips.hint")}
        </At>
        {intentRow > 0 ? (
          <>
            <At
              r={L.intentLabel}
              style={{
                display: "flex",
                alignItems: "center",
                fontSize: 12,
                fontWeight: 500,
                color: theme.fgSubtle,
                opacity: intentRow,
                transform: `translateY(${(1 - intentRow) * 4}px)`,
              }}
            >
              {t("form.chips.whereLabel")}
            </At>
            {pills.map((r, i) => {
              const id = intentIds[i]!;
              const active = scenario.search.intents.includes(id);
              return (
                <At
                  key={id}
                  r={r}
                  style={{ opacity: intentRow, transform: `translateY(${(1 - intentRow) * 4}px)` }}
                >
                  {active && pulse > 0 && pulse < 1 ? (
                    <div
                      style={{
                        position: "absolute",
                        inset: -2,
                        borderRadius: 999,
                        border: `2px solid ${theme.brand}`,
                        opacity: 0.8 * (1 - pulse),
                        transform: `scale(${1 + 0.35 * pulse})`,
                      }}
                    />
                  ) : null}
                  <div
                    style={{
                      height: "100%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      borderRadius: 999,
                      border: `1px solid ${active ? theme.brand : theme.borderSubtle}`,
                      background: active ? theme.brandSoft : theme.surface,
                      color: active ? theme.brandSoftFg : theme.fgMuted,
                      fontSize: 12,
                      fontWeight: 500,
                    }}
                  >
                    {intentLabels[i]}
                  </div>
                </At>
              );
            })}
          </>
        ) : null}

        {/* --- 3. anything specific ------------------------------------------ */}
        <At r={L.card3}>
          <Card style={{ width: "100%", height: "100%" }} />
        </At>
        <At r={{ ...L.heading3, height: 60 }}>
          <SectionHeading eyebrow="3" description={t("form.request.description")}>
            {t("form.request.label")}
          </SectionHeading>
        </At>
        <At r={L.requestLabel} style={{ ...label, display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <span>{t("form.request.fieldLabel")}</span>
          <span style={{ fontSize: 12, fontWeight: 400, color: theme.fgSubtle }}>{t("form.optional")}</span>
        </At>
        <At
          r={L.textarea}
          style={{
            ...inputBox,
            alignItems: "flex-start",
            padding: "10px 12px",
            lineHeight: "22.75px",
            borderColor: focus > 0.5 ? theme.brand : theme.borderStrong,
            boxShadow: focus > 0 ? `0 0 0 ${3 * focus}px rgb(${theme.brandRgb} / 0.18)` : undefined,
          }}
        >
          {request.length > 0 ? (
            <span style={{ color: theme.fg }}>{request}</span>
          ) : (
            <span style={{ color: theme.fgSubtle }}>{focus > 0.5 ? "" : t("form.request.placeholder")}</span>
          )}
          {focus > 0.5 && (caretOn || (typed > 0 && typed < scenario.search.request.length)) ? (
            <span style={{ display: "inline-block", width: 1.5, height: 18, marginTop: 2, marginLeft: 1, background: theme.brand }} />
          ) : null}
        </At>
        <At
          r={L.examplesLabel}
          style={{ fontSize: 12, fontWeight: 500, letterSpacing: "0.05em", textTransform: "uppercase", color: theme.fgSubtle }}
        >
          {t("form.request.examples")}
        </At>
        {PRESETS.map((id, i) => {
          const r = L.presets[i];
          if (!r) return null;
          return (
            <At
              key={id}
              r={r}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
                padding: 12,
                borderRadius: 12,
                border: `1px solid ${theme.borderSubtle}`,
                background: theme.surfaceMuted,
              }}
            >
              <span style={{ marginTop: 2, color: theme.fgSubtle }}>
                <SearchIcon size={16} />
              </span>
              <span>
                <span style={{ display: "block", fontSize: 14, fontWeight: 500, lineHeight: "19px", color: theme.fg }}>
                  {t(`form.presets.${id}.title`)}
                </span>
                <span style={{ display: "block", marginTop: 2, fontSize: 12, color: theme.fgMuted }}>
                  {t(`form.presets.${id}.where`)}
                </span>
              </span>
            </At>
          );
        })}

        {/* --- advanced + submit ----------------------------------------------- */}
        <At r={L.advanced} style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 4px", fontSize: 14, fontWeight: 500, color: theme.fgMuted }}>
          <ChevronIcon size={14} />
          <SlidersIcon size={16} />
          {t("form.advanced")}
        </At>
        <At r={L.submitCard}>
          <Card tone="brand" style={{ width: "100%", height: "100%" }} />
        </At>
        <At
          r={{ x: L.submitCard.x + 24, y: L.submitCard.y + 24, width: L.submitCard.width - 48 - 220, height: 116 }}
          style={{ display: "flex", flexDirection: "column", gap: 12, color: theme.brandSoftFg, fontSize: 14 }}
        >
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <ClockIcon size={16} style={{ marginTop: 3 }} />
            <span style={{ lineHeight: "22.75px" }}>{t("form.submitNote", { minutes: 8 })}</span>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <span
              style={{
                marginTop: 2,
                width: 16,
                height: 16,
                borderRadius: 4,
                background: theme.brand,
                color: theme.brandFg,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <CheckIcon size={12} strokeWidth={3} />
            </span>
            <span>
              <span style={{ display: "block", fontWeight: 500, lineHeight: "19px" }}>{t("form.quickSearch.label")}</span>
              <span style={{ display: "block", marginTop: 2, fontSize: 12, lineHeight: "19.5px", opacity: 0.8 }}>
                {t("form.quickSearch.hint")}
              </span>
            </span>
          </div>
        </At>
        <At
          r={L.submitButton}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            borderRadius: 8,
            background: theme.brand,
            color: theme.brandFg,
            fontSize: 16,
            fontWeight: 500,
            boxShadow: theme.shadowCard,
            opacity: submitting > 0 ? 1 - 0.35 * submitting : 1,
          }}
        >
          {submitting > 0 ? <Spinner size={18} /> : <SearchIcon size={20} />}
          {submitting > 0 ? t("form.submitting") : t("form.submit")}
        </At>

        {/* --- footer ------------------------------------------------------------ */}
        <At r={L.footer} style={{ borderTop: `1px solid ${theme.borderSubtle}` }}>
          <div style={{ width: 976, margin: "24px auto 0", display: "flex", gap: 6, fontSize: 12, color: theme.fgMuted }}>
            <InfoIcon size={14} color={theme.fgSubtle} style={{ marginTop: 1 }} />
            {disclaimerFor(scenario.locale)}
          </div>
        </At>
      </div>
      <AppHeader active="newSearch" />
    </div>
  );
}
