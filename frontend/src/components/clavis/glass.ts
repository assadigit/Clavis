/**
 * CLAVIS — theme control.
 * The app follows the Bitwarden design system: a flat light theme by default
 * and a Bitwarden dark theme when the `solid` class is present on <html>
 * (Settings → Appearance → Dark mode; previously "solid mode").
 */
export function applyTheme(solid: boolean): void {
  document.documentElement.classList.toggle("solid", solid);
}
