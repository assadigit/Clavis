/**
 * CLAVIS — dropdown / context menu. Moved from ui-bits.tsx (move-only;
 * ui-bits.tsx re-exports the public surface).
 *
 * v1.16.0 (DECISIONS §58): the open panel renders through a PORTAL into
 * document.body with position: fixed, anchored to the trigger's viewport
 * rect. The old in-flow absolute panel lived inside the editor scroll
 * containers — opening downward from a footer grew the scroller's
 * overflow (the owner's "more scroll and dead space instead of
 * overlaying"), and from the full editors' pinned modal footers it
 * rendered below the modal panel. Fixed positioning overlays properly:
 * it never contributes to any scroller and escapes every overflow clip.
 * The panel flips up when the space below is short (the footers' common
 * case), clamps inside the viewport, and closes on scroll/resize so it
 * can never float detached from its anchor.
 */
"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { LucideIcon } from "lucide-react";
import { Ix } from "../icons";
import { useDismiss } from "./dismiss";
import { btnClasses, type BtnVariant } from "./buttons";

/** Gap between trigger edge and panel, and the panel's minimum inset from
 * the viewport edge. Plain numbers (not tokens): this is window geometry
 * math, like the popup positioning in Go/TS — never theme styling. */
const ANCHOR_GAP = 8;

/** The trigger's viewport rect at the moment the menu opened. */
interface Anchor {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export function Menu({
  triggerIcon,
  triggerLabel,
  triggerTitle,
  triggerStyle,
  triggerClassName,
  triggerVariant = "glass",
  align = "end",
  direction = "down",
  disabled,
  menuStyle,
  children,
}: {
  triggerIcon?: LucideIcon;
  triggerLabel?: ReactNode;
  triggerTitle?: string;
  triggerStyle?: CSSProperties;
  triggerClassName?: string;
  triggerVariant?: BtnVariant;
  align?: "start" | "end";
  direction?: "down" | "up";
  disabled?: boolean;
  menuStyle?: CSSProperties;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  /* Measured panel size after mount — the panel renders hidden for one
     pass until the flip/clamp math has real numbers (jsdom reports 0×0,
     which still counts as measured, so tests see a visible panel). */
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  const menuRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const close = useCallback(() => setOpen(false), []);
  /* The portaled panel counts as "inside" (dismiss.ts v1.16.0): clicks on
     menu items are real clicks, not outside-dismissals. */
  const ref = useDismiss(open, close, menuRef);

  function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    /* Capture the anchor BEFORE the state flips — re-reading the rect in
       an effect would already see layout after the render. */
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return;
    setAnchor({ top: r.top, bottom: r.bottom, left: r.left, right: r.right });
    setSize(null);
    setOpen(true);
  }

  /* Measure once per open (menu children are static per usage). */
  useLayoutEffect(() => {
    if (!open || !menuRef.current) return;
    const el = menuRef.current;
    setSize({ w: el.offsetWidth, h: el.offsetHeight });
  }, [open]);

  /* A fixed panel must never detach from its anchor: any scroll (capture
     on document — scroll events do not bubble) or window resize closes
     the menu instead. */
  useEffect(() => {
    if (!open) return undefined;
    const onMove = () => setOpen(false);
    document.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      document.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open]);

  const vw = typeof window === "undefined" ? 0 : window.innerWidth;
  const vh = typeof window === "undefined" ? 0 : window.innerHeight;

  let panelStyle: CSSProperties = { top: 0, left: 0 };
  if (anchor) {
    const w = size?.w ?? 0;
    const h = size?.h ?? 0;
    /* Horizontal: aligned to the trigger's edge, clamped inside the
       viewport. */
    let left = align === "end" ? anchor.right - w : anchor.left;
    if (vw > 0) {
      const maxLeft = Math.max(ANCHOR_GAP, vw - w - ANCHOR_GAP);
      left = Math.min(Math.max(left, ANCHOR_GAP), maxLeft);
    }
    /* Vertical: the requested direction first, flipped only when it
       cannot fit AND the other side can. */
    const below = anchor.bottom + ANCHOR_GAP;
    const above = anchor.top - ANCHOR_GAP - h;
    let top = below;
    if (direction === "up") {
      top = above;
      if (vh > 0 && top < ANCHOR_GAP && below + h <= vh - ANCHOR_GAP) top = below;
    } else if (vh > 0 && top + h > vh - ANCHOR_GAP && above >= ANCHOR_GAP) {
      top = above;
    }
    panelStyle = { top, left };
  }

  const v = btnClasses(triggerVariant);

  return (
    <div ref={ref} className="relative inline-flex">
      <button
        type="button"
        ref={triggerRef}
        disabled={disabled}
        title={triggerTitle}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
        className={`clavis-btn ${v} ${triggerClassName ?? ""}`}
        style={triggerStyle}
      >
        {triggerIcon ? <Ix icon={triggerIcon} size="sm" /> : null}
        {triggerLabel !== undefined ? <span>{triggerLabel}</span> : null}
      </button>
      {/* zIndex 100: above the modal layer (80), so the menu also overlays
          correctly from the full editors' pinned footers. */}
      {open && anchor
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              className="clavis-menu clavis-pop-in"
              onClickCapture={(e) => {
                /* Choosing an item closes the menu — standard dropdown
                   behavior (the old in-flow panel kept it open after
                   exports). Capture phase: the item's own onClick still
                   runs in the same dispatch; the unmount commits after
                   the event completes. Disabled items swallow clicks
                   before this fires. */
                if ((e.target as HTMLElement).closest('[role="menuitem"]') !== null) setOpen(false);
              }}
              style={{
                position: "fixed",
                zIndex: 100,
                visibility: size === null ? "hidden" : "visible",
                ...panelStyle,
                ...menuStyle,
              }}
            >
              {children}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

export function MenuItem({
  icon,
  label,
  danger,
  disabled,
  onClick,
  hint,
}: {
  icon?: LucideIcon;
  label: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  /** Optional one-line warning under the label (UI-audit round 1 Phase 4,
   * F-003 — e.g. the plaintext warning on export items). */
  hint?: string;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      data-danger={danger ? "true" : undefined}
      className="clavis-menu-item"
      onClick={onClick}
    >
      {icon ? (
        <Ix icon={icon} size="sm" style={danger ? { color: "var(--color-danger-text)" } : undefined} />
      ) : null}
      <span style={{ whiteSpace: "nowrap" }}>
        <span style={{ display: "block" }}>{label}</span>
        {hint ? (
          <span
            className="t-warning"
            style={{ display: "block", whiteSpace: "normal", fontSize: "var(--text-xs)", maxWidth: "calc(var(--space-6) * 11)", lineHeight: "var(--leading-tight)" }}
          >
            {hint}
          </span>
        ) : null}
      </span>
    </button>
  );
}
