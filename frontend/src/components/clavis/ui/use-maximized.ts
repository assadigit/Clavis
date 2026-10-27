/**
 * CLAVIS — maximize-state mirror. Extracted in UI-audit round 1 Phase 10
 * (F-027): the desk frame (manager-entry) and the Manager chrome used to
 * each keep their own resize listener for the same fact.
 */
"use client";

import { useEffect, useState } from "react";

/** True while the real window fills the screen work-area (edge-to-edge). */
export function useMaximized(): boolean {
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    const onResize = () => setMaximized(window.innerWidth >= window.screen.availWidth - 8);
    window.addEventListener("resize", onResize);
    onResize();
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return maximized;
}
