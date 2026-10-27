# Clavis UI/UX audit — round 1

**Plain-language summary for the owner**

In January 2026 a full UI/UX audit of Clavis was performed: every screen was examined against 12 standard lenses (visual hierarchy, spacing, typography, color, consistency, states, flow, responsiveness, accessibility, copy, performance feel, code health) plus the desktop/tray/forms lenses that apply to a Windows tray app. The web front end was really run and photographed (34 before-screenshots); the Windows-only parts (tray, hotkey, clipboard privacy) were verified by reading the code and are labeled as such — this session ran on Linux, where those parts cannot run.

**The verdict in one paragraph:** Clavis is in unusually good shape for its age. The design tokens are consistent (zero hard-coded colors in components), the popup implements the full ARIA combobox pattern, the copy is calm and human, and the safety engineering (masked previews, fail-closed clipboard privacy, undo on every delete, backups before imports) is genuinely careful. The problems found are mostly *unfinished patterns* — a fix that exists in one window but not the other, a modal system that never learned focus trapping, a stale token file the docs still point to — plus one real feature gap that the owner themselves asked for: exporting a single group to a file that can be imported back losslessly.

**What this folder is for:** it is the complete, self-contained record of the audit *and* the instruction pack for the next session, which will implement the fixes in phases and release v1.3.0. Nothing in the Clavis product code was changed by the audit session itself.

## The top 10 findings (of 28 — full list in `02-findings.md`)

1. **F-001 (P1)** — If the manager window can't load your data, it shows "Clavis could not load" and nothing else. No retry button. The popup has a retry panel for the same failure; the manager never got it. Dead end.
2. **F-004 (P1)** — Dialogs don't trap the keyboard: after opening a dialog, Tab moves to things behind it. Affects every modal in the app.
3. **F-017 (P1, feature)** — You can export a group as Markdown or TXT, but those files lose data when re-imported (notes, tags, per-item settings, shared items become copies). What you asked for — "export this group, import it later" — doesn't exist yet: a per-group **JSON** export + merge import is planned (Phase 4).
4. **F-009 (P2)** — Entry names get cut off ("Test Project Se…") in the main list even at normal window sizes — the column you scan most is the one that runs out of room first.
5. **F-011 (P2)** — There are two "design tokens" files. The one the README calls the single source of style is an old, dead copy of a previous theme. A future edit there would silently do nothing.
6. **F-018 (P2)** — "Export all as Markdown" silently drops each item's Note field. It looks like a backup but isn't.
7. **F-005 (P2)** — In Settings, the three backup "Restore" buttons are indistinguishable to screen readers (all just called "Restore").
8. **F-002 (P2)** — After "Check for updates", the result is never announced to screen readers; the progress bar has no values for assistive tech.
9. **F-021 (P2)** — The manager contains a whole mobile layout that can never appear (the window can't be resized below 800 px). Dead code that will rot.
10. **F-025 (F-026, P2)** — Dead code (unused components, a setting that does nothing) and 5 near-500-line screen files that make every future edit riskier than it should be.

## Documents in this folder

| File | What it is |
|---|---|
| `README.md` | This page |
| `00-TASK.md` | The task the owner gave this session (kept for verification; credentials redacted) |
| `01-explore-notes.md` | What Clavis is, the verified stack, how to run it, which audit lenses applied, **how the project ships** |
| `01b-baseline.md` | The "what works today" checklist — re-run after every upgrade phase |
| `02-findings.md` | All 28 findings with evidence, severity, file:line, fix direction, and verification recipes |
| `03-diagnosis.md` | The 8 root causes behind the findings + the must-not-break list |
| `04-fix-plan.md` | The phased plan (12 phases + final re-audit + release) — what, why, in what order |
| `04b-implementation-plan.md` | The code-level companion to the plan — exact files, data shapes, signatures, and test matrices per phase |
| `05-session2-prompt.md` | **The ready-to-paste prompt for the next session** |
| `PROGRESS.md` | The upgrade tracker (all phases "not started"; rollback plan to be filled before release) |
| `06-next-focus.md` | *Written at the end of the implementation session* — what round 2 should focus on |
| `07-before-after.md` | *Written at the end of the implementation session* — before/after image pairs in plain language |
| `evidence/before/` | 34 before-screenshots (fake data only; no real secrets) |
| `evidence/after/` | *Filled by the implementation session* |

## How to start the next session

Open a brand-new session in this repository and paste the contents of **`05-session2-prompt.md`** (everything below its divider line) as the first message. That session will read these documents, create the `pre-ui-upgrade-round-1` restore tag, and execute the phases automatically — no programming knowledge needed from you. It will release v1.3.0 at the end and tell you how to undo it.

If anything ever looks wrong: everything is reversible. The audit's restore point is the git tag `pre-ui-audit-round-1`; the upgrade session creates `pre-ui-upgrade-round-1` before its first change.
