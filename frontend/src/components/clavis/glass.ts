/**
 * CLAVIS — glass appearance control (SPEC §5.9).
 * Glass intensity (0–100) scales the glass alphas and blur; solid mode swaps
 * the glass recipes for solid surfaces via the `solid` class on <html>.
 * The formulas below are the ones mandated by the build brief:
 *   --glass-bg:         rgba(255,255,255, 0.10 * i)
 *   --glass-bg-hover:   rgba(255,255,255, 0.14 * i)
 *   --glass-bg-selected:rgba(255,255,255, 0.20 * i)
 *   --glass-blur:       max(0, 20px * i)
 * where i = intensity / 100.
 */
export function applyGlassVars(intensity: number, solid: boolean): void {
  const i = Math.max(0, Math.min(100, Math.round(intensity) || 0)) / 100;
  const root = document.documentElement;
  root.style.setProperty("--glass-bg", `rgba(255, 255, 255, ${(0.1 * i).toFixed(3)})`);
  root.style.setProperty("--glass-bg-hover", `rgba(255, 255, 255, ${(0.14 * i).toFixed(3)})`);
  root.style.setProperty("--glass-bg-selected", `rgba(255, 255, 255, ${(0.2 * i).toFixed(3)})`);
  root.style.setProperty("--glass-blur", `${Math.max(0, 20 * i).toFixed(1)}px`);
  root.classList.toggle("solid", solid);
}
