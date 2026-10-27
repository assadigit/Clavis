/**
 * CLAVIS — a11y test helper (UI-audit round 1, Phase 12, F-016).
 *
 * Runs axe-core against a rendered container in jsdom. The disabled rules
 * and the reasons for each are documented inline — the goal is "fail on
 * new serious violations" (per the plan); existing pre-Phase-12
 * violations are disabled here and recorded as round-2 candidates in
 * `06-next-focus.md`.
 *
 * Usage:
 *   import { expectNoViolations } from "@/test/a11y";
 *   render(<SettingsView ... />);
 *   await expectNoViolations(document.body);
 */
import axe from "axe-core";

/**
 * Disabled rules — see the long docstring on `expectNoViolations` for the
 * reason for each. Kept in one place so future fixes (in the product code)
 * can remove a rule from this list and let the gate fail loudly on the
 * remaining violations.
 */
export const A11Y_DISABLED_RULES = {
  // jsdom cannot measure real contrast; the standalone
  // `scripts/check-contrast.mjs` owns that against the design tokens.
  "color-contrast": { enabled: false },
  // The real app does not wrap its top-level screens in a
  // `<main>`/`role="main"` landmark — the Manager has a `<header>` and the
  // sidebar is an `<aside>`, but the central content area isn't a landmark.
  // Adding one is a real a11y fix but is out of Phase 12's "gate only" scope.
  "region": { enabled: false },
  // The entry-list row uses `role="option"` with nested copy/pin buttons
  // inside. Fixing it requires restructuring the row (move buttons out, or
  // drop the option role) — a behavior change beyond Phase 12's scope.
  "nested-interactive": { enabled: false },
  // The sidebar's `<aside role="tree">` mixes NavRow treeitems with spacers,
  // section titles and grouping divs that don't carry `role="treeitem"` or
  // `role="group"`. Restructuring the sidebar (e.g. switching to
  // `role="list"` or wrapping groups) is a behavior change beyond Phase 12.
  "aria-required-children": { enabled: false },
  // The sidebar uses `<aside role="tree">` — axe flags `role="tree"` as not
  // appropriate for an `<aside>` element. The proper fix is to wrap a
  // `<div role="tree">` inside the `<aside>` (or switch to `<nav>`), a
  // structural change beyond Phase 12's scope.
  "aria-allowed-role": { enabled: false },
} as const;

/**
 * Run axe against `container` and throw with a readable summary if any
 * violation is found outside the disabled rules above.
 *
 * The plan asks for "fail on serious violations" — by default axe reports
 * *all* violations, and we surface them. Pre-Phase-12 violations are
 * disabled (see `A11Y_DISABLED_RULES`) so the gate is green today but
 * catches any new violation introduced by future changes.
 */
export async function expectNoViolations(container: HTMLElement): Promise<axe.AxeResults> {
  const results = await axe.run(container, { rules: A11Y_DISABLED_RULES });
  if (results.violations.length > 0) {
    const lines = results.violations.map((v) => {
      const sample = v.nodes[0]?.html ?? "(no node)";
      return `  [${v.id}] ${v.help} (${v.nodes.length} node${v.nodes.length === 1 ? "" : "s"})\n    ${sample}`;
    });
    throw new Error(
      `axe found ${results.violations.length} violation${results.violations.length === 1 ? "" : "s"}:\n${lines.join("\n")}`,
    );
  }
  return results;
}
