/**
 * CLAVIS — escape-stack dismissal (shared by menus, popovers and modals).
 * Only the topmost overlay closes on Esc. Moved from ui-bits.tsx
 * (move-only; ui-bits.tsx re-exports the public surface).
 */
import { useEffect, useRef } from "react";

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

/** Outside-pointer + Esc dismissal for popovers (menus, suggestions). */
export function useDismiss(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEscStack(open, onClose);
  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (ev: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(ev.target as Node)) onClose();
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("touchstart", onPointer);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("touchstart", onPointer);
    };
  }, [open, onClose]);
  return ref;
}
