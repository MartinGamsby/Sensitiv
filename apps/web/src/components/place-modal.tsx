"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { CloseIcon } from "./ui/icon.tsx";

/**
 * The chrome an open place detail sits in: backdrop, panel, Escape, a focus
 * trap and a close button.
 *
 * Presentation only — it owns no state and decides nothing about what is
 * open. `onClose` is supplied by the caller, which drives the whole thing
 * off `?place=` in the URL, so "closed" is a fact about the address bar
 * rather than about this component.
 */
export function PlaceModal({
  children,
  onClose,
}: {
  children: ReactNode;
  onClose: () => void;
}) {
  const t = useTranslations("dossier");
  const panelRef = useRef<HTMLDivElement>(null);
  // Through a ref so the effect below can have an empty dependency list and
  // still call the current callback. Depending on `onClose` directly would
  // re-run the effect on every parent render, and each run pulls focus back
  // to the panel — which would fight the reader mid-Tab.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const close = () => onCloseRef.current();

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      // Keep Tab inside the dialog. Without this, tabbing walks into the
      // dossier behind the overlay — which is still fully rendered, because
      // a parallel route does not unmount the page it covers.
      const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    // The page behind must not scroll under the overlay.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus?.();
    };
  }, []);

  return (
    <div
      data-testid="place-modal"
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/60 p-4 backdrop-blur-sm sm:p-8"
      // The backdrop closes, but only when the backdrop itself is the target
      // — a click that started on the panel and drifted out while selecting
      // text must not dismiss what the reader was copying.
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("detail.dialogLabel")}
        tabIndex={-1}
        className="relative w-full max-w-3xl rounded-xl border border-border-subtle bg-surface p-5 shadow-raised outline-none sm:p-6"
      >
        <button
          type="button"
          onClick={close}
          aria-label={t("detail.close")}
          className="absolute right-3 top-3 rounded-lg p-1.5 text-fg-muted transition-colors hover:bg-surface-muted hover:text-fg"
        >
          <CloseIcon className="h-4 w-4" />
        </button>
        {children}
      </div>
    </div>
  );
}
