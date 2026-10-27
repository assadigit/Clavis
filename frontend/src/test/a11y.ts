/**
 * CLAVIS — a11y test helper (UI-audit round 1, Phase 12, F-016; tightened
 * in v1.3.1).
 *
 * Runs axe-core against a rendered container in jsdom. The disabled rules
 * and the reasons for each are documented inline — the goal is "fail on
 * new serious violations" (per the plan).
 *
 * v1.3.1: the four rules Phase 12 had to disable (`region`,
 * `nested-interactive`, `aria-required-children`, `aria-allowed-role`) are
 * LIVE again — the v1.3.1 markup fixes removed the underlying violations
 * (the sidebar is a plain `<aside>` of buttons instead of an invalid
 * `role="tree"`; the entry list is `role="list"`/`role="listitem"` instead
 * of a listbox with nested interactives; the standalone sub-screens render
 * inside the production `<aside aria-label="Details">` landmark in the
 * tests). Only `color-contrast` stays disabled — jsdom cannot measure it;
 * `scripts/check-contrast.mjs` owns it against the design tokens.
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
} as const;

/**
 * Run axe against `container` and throw with a readable summary if any
 * violation is found outside the disabled rules above.
 *
 * The plan asks for "fail on serious violations" — by default axe reports
 * *all* violations, and we surface them. Only `color-contrast` is disabled
 * (jsdom can't measure it; the contrast script owns it), so the gate is
 * green today but catches any new violation introduced by future changes.
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
