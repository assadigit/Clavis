# 00 — The task this audit was given (verbatim record)

Saved to the repository at the owner's request ("save this document on github, so you can verify and check with it during the process"). Future sessions should compare their work against this original brief.

> **Security note:** the owner's GitHub token was provided in the chat only. It is **redacted here** and must never appear in any file, commit, log, or screenshot. The same applies to any credential the owner provides in a future session.

---

## TASK: Full UI/UX audit, diagnosis, and phased upgrade plan (round 1)

You are a senior UI/UX auditor and engineer. Audit this project end to end, write your results into the repo as documents, and prepare a plan and a prompt that a fresh session will use to carry out the upgrade in phases.

**This session changes NO product code.** It only reads, runs, and measures the project, and writes documents. The upgrade happens in a later session.

The owner is not a programmer and cannot read or repair code. So: be careful, keep everything reversible, give proof they can look at, and write summaries in plain language.

### Project

- Project: **Clavis** — "Your keys, one shortcut away." A tiny, ultra-fast Windows 10/11 tray app for people who copy the same credentials, prompts and notes all day long. The core loop: press Ctrl + Shift + Space anywhere in Windows, type a few letters (for example `ghtk` finds "GitHub token"), press Enter, and the item is on the clipboard. Copied secrets are automatically kept out of the Windows clipboard history (Win+V) and out of cloud clipboard sync. The speed and keyboard-only feel of that core loop is the heart of the product, so judge every screen by how well it serves that loop.
- Location: GitHub repository `github.com/assadigit/Clavis`. If this session is already opened inside a clone of it, use that. If not, clone it into the current folder. The owner gives you GitHub access (credentials or a logged-in tool) so you can read, clone, and push on your own. Use that access as it is provided. **Never print, copy, write into any file, or commit the credentials, tokens, or passwords, and never put them in a remote URL, a log, or a screenshot.** If the access does not work, write the exact error into the notes and continue with whatever you can reach.
- Type: Windows tray app with a hotkey-activated popup. From the repository's language mix (about 48% TypeScript, 44% Go, 7% CSS, 1% NSIS installer script, a little HTML) it is probably a Go desktop app with a web front end and an NSIS installer, but this is a guess: verify the real stack in Stage 1 and never assume it. Clavis targets Windows 10/11. If your session is not running on Windows, you cannot run the tray, the global hotkey, or the clipboard behavior: mark every finding about them "static analysis only" and say so plainly. You may still run and screenshot the web front end on its own.
- Goal: Find everything that weakens the UI/UX, diagnose why, and plan a safe, prioritized upgrade.
- Round: 1. This is the first round.

### Off-limits areas

Report on these, never change them:

- The secret-protection logic: how credentials are stored, encrypted, or unlocked; the code that keeps copied secrets out of the Windows clipboard history and out of cloud clipboard sync; and the global hotkey registration and clipboard-writing code. You may read it, run it, and report UI/UX problems around it (for example confusing feedback after a copy), but you must not edit it. If a UI fix would need to touch it, record the finding as "report only (off-limits)".
- The owner's real stored entries. Never open, read, print, copy, or screenshot the owner's real vault or data file. For testing, create fake entries with obviously fake values (for example "Test GitHub token" = `FAKE-TOKEN-123`) in a separate test data location if the app allows it, and delete them when done. Screenshots must never show real secrets.

Default protections that always apply: never run destructive actions on data (databases, user files, stored records); never run schema migrations unless the plan lists them and they are reversible; never process real payments or send real messages to real customers; never print, copy, or commit secrets, tokens, or passwords.

### Design reference

None given. Judge consistency within the project itself.

### Priority lenses from the owner

None given. Use the standard lens order.

### Standard lenses

1. Visual hierarchy · 2. Alignment and spacing · 3. Typography · 4. Color and contrast · 5. Consistency and design tokens · 6. States · 7. Flow and clarity · 8. Responsiveness and window behavior · 9. Accessibility · 10. Copy and microcopy · 11. Performance feel · 12. UI code health

*(Full text of each lens as given by the owner is preserved in the audit session's working notes; the documents in this folder apply all of them — see `02-findings.md` headers.)*

### Conditional lenses

- **Farsi / RTL interface** — apply if the project contains Farsi or Arabic text, `dir="rtl"`, `lang="fa"`, RTL-specific CSS, or Farsi fonts. *(Decision: does not apply — see `01-explore-notes.md` §5.)*
- **Desktop app** — apply if the project uses PyQt, PySide, Tkinter, wxPython, Kivy, Dear PyGui, Flet, Wails, Electron, Tauri or similar. *(Decision: applies — Wails v3.)*
- **Forms and wizards** — apply if there are multi-field forms or multi-step flows. *(Decision: applies.)*
- **Tray / background apps** — apply if the project has system tray code. *(Decision: applies.)*

### How to run and check this kind of project

- Find the real run command in the README, `package.json` scripts, `Makefile`, `go.mod`, `wails.json`, or equivalent. Do not guess.
- Install extra tools only inside the project's tooling or a temporary folder, never as project dependencies unless the plan says so.
- Check each main screen at three sizes (about 375 / 768 / 1280 px) where the project resizes.
- Check keyboard-only use: Tab through everything, visible focus, Enter/Space/Escape.
- Read console/terminal/log output while using the project.
- Trigger empty, loading, and error states on purpose.
- Desktop apps with web interfaces: run the project's dev command; check the web front end in a browser; take an OS screenshot of the real window when possible.
- Tray apps: also check tray icon and menu, global hotkey, startup behavior, close behavior, multiple monitors.
- For Clavis specifically, time and describe the core loop.
- Shipping rules: build and run the tests first; deploy only if they pass; record what is live before you change it; write the rollback plan before deploying; check the live result afterwards.

### Documents

All documents in `docs/ui-audit/round-1/`; screenshots in `evidence/before/` (max ~40 images, ~under 300 KB each, named by screen and size, never showing real secrets).

### Stages

- Stage 0: Safety and setup — git status, check for interrupted previous run, restore point tag `pre-ui-audit-round-1`, note OS/shell.
- Stage 1: Explore — stack, run/build, conditional lens decisions, "How this project ships" section → `01-explore-notes.md`.
- Stage 2: Monitor and baseline — run it for real, resize, keyboard-only, empty/loading/error states, before screenshots → `01b-baseline.md`.
- Stage 3: Audit — area by area, findings in the fixed format (ID, Lens, Severity, Where, Evidence, Why it matters, Suggested fix, Effort, Verify, Status) → `02-findings.md`, saved incrementally.
- Stage 4: Diagnose — group findings by root cause → `03-diagnosis.md`.
- Stage 5: Plan — phases ordered by priority with dependencies first; each phase has Goal, Finding IDs, Tasks, Milestone, Verification (incl. baseline re-run), Do not touch, Rollback point; "Deferred and out of scope" section; final phases: Final re-audit, Release → `04-fix-plan.md`.
- Stage 6: Write `05-session2-prompt.md` (self-contained next-session prompt), `PROGRESS.md` (all phases "not started", empty Rollback plan section), `README.md` (plain summary, top 10 findings, document list, how to start the next session).
- Stage 7: Commit and push only `docs/ui-audit/round-1/`, explicit paths, message `docs: UI/UX audit round 1, diagnosis, and phased plan`. No secrets. Modest screenshots.

### Quality rules

Evidence over opinion · Root causes over symptoms · Be specific · Do not invent facts — unknown stays "unknown" · Be honest about limits · Write for someone who has never seen this project · Save work to disk as you go.

### Final report

Where the documents are, the 5 most important findings, the number of phases, how the project ships, and the exact first step for starting the next session — short and plain.

---

## Owner's additions (same message, after the task)

1. "save this document on github, so you can verify and check with it during the process." — done: this file.
2. "Also I want a full export + per group credentials export, so i can easily import my credentials later. For example I have 20 passwords under a group in clavis, I export that group and easily import next time." — recorded as finding **F-017 (P1)** and planned as **Phase 4** of `04-fix-plan.md` (full export already exists as the JSON backup; the per-group JSON export + merge import is the new work). The audit session changed no product code, so the feature is implemented by the next session.
3. GitHub Token: `[REDACTED — provided in chat only; never written to any file]`
