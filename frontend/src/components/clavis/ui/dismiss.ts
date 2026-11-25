/**
 * CLAVIS — escape-stack dismissal (shared by menus, popovers and modals).
 * Only the topmost overlay closes on Esc. Moved from ui-bits.tsx
 * (move-only; ui-bits.tsx re-exports the public surface).
 */
import { useEffect, useRef, type RefObject } from "react";

const escStack: Array<() => void> = [];

function escDocHandler(ev: KeyboardEvent) {
  if (ev.key !== "Escape") return;
  const top = escStack[escStack.length - 1];
  if (top) {
    ev.stopPropagation();
    ev.preventDefault();
    top();
  }
}
if (typeof document !== "undefined") {
  document.addEventListener("keydown", escDocHandler, true);
}

export function useEscStack(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return undefined;
    escStack.push(onClose);
    return () => {
      const i = escStack.indexOf(onClose);
      if (i >= 0) escStack.splice(i, 1);
    };
  }, [open, onClose]);
}

/** Outside-pointer + Esc dismissal for popovers (menus, suggestions).
 * v1.16.0: `extra` counts one more element (e.g. a panel portaled to
 * document.body, like the Menu's fixed dropdown) as "inside" — a pointer
 * down on it must not dismiss before its own click handlers fire. */
export function useDismiss(open: boolean, onClose: () => void, extra?: RefObject<Element | null>) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEscStack(open, onClose);
  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (ev: MouseEvent | TouchEvent) => {
      const target = ev.target as Node;
      if (ref.current && ref.current.contains(target)) return;
      if (extra && extra.current && extra.current.contains(target)) return;
      onClose();
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("touchstart", onPointer);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("touchstart", onPointer);
    };
  }, [open, onClose, extra]);
  return ref;
}
