# 05 — Session 2 prompt: run the UI/UX upgrade (round 1)

Copy everything below the line into the new session as its first message. It is self-contained: the new session has not seen this audit session.

---

You are a senior UI/UX engineer working on **Clavis** (github.com/assadigit/Clavis), a Windows tray app (Wails v3 beta + Go + React 19 + TypeScript + Vite + Tailwind 4) for keyboard-first clipboard credentials. The owner is **not a programmer**: be careful, keep everything reversible, and give proof they can look at.

Your job: execute the phased upgrade plan in `docs/ui-audit/round-1/04-fix-plan.md` (mechanics detailed in `04b-implementation-plan.md`), phase by phase, then re-audit and release. **A previous session already performed the full audit — do not re-audit, do not re-plan.** This session *does* change product code, exactly as the plan says and nothing more.

## 0. Read first, before touching any code

Read these documents in the repo, in this order:
1. `docs/ui-audit/round-1/README.md`
2. `docs/ui-audit/round-1/00-TASK.md` (the original task the owner gave — for context only)
3. `docs/ui-audit/round-1/01-explore-notes.md` (stack, how to run, how the project ships)
4. `docs/ui-audit/round-1/01b-baseline.md` (the "what works today" checklist — you re-run this after every phase)
5. `docs/ui-audit/round-1/02-findings.md` (every finding, with file:line evidence)
6. `docs/ui-audit/round-1/03-diagnosis.md` (root causes and the must-not-break list)
7. `docs/ui-audit/round-1/04-fix-plan.md` (your work order: phases, milestones, verification, standing rules)
8. `docs/ui-audit/round-1/04b-implementation-plan.md` (the code-level companion: exact files, anchors, data shapes, signatures, test matrices — read the section for a phase right before you do that phase)
9. `docs/ui-audit/round-1/PROGRESS.md` (what is already done — resume from the first unfinished phase)

## 1. Safety setup (do this before the first change)

1. Check `git status`. If there are **uncommitted changes, they belong to the owner**: never touch, stash, reset, discard, or commit them. From now on, stage files **only by explicit path** — never `git add -A` or `git add .`.
2. If a file the plan tells you to change already has the owner's uncommitted edits, **skip that task**, record the skip in `PROGRESS.md` (what, why, which file), and continue with the rest of the phase.
3. Create the restore point: `git tag pre-ui-upgrade-round-1` at the current commit and push the tag to the remote. If the repo has no remote, note it and continue.
4. Note your OS. The audit session ran on Linux: the web front end runs anywhere (`cd frontend && bun install && bun run dev`), Go core tests run with `go test ./internal/...`, but **tray/hotkey/clipboard/Win32 behavior needs Windows** — keep marking those checks accordingly. If you are on Windows, you can additionally `wails dev` / run the built exe; use it for the smoke checks where the plan says so.
5. Never print, copy, or commit any credential, token, or password. The owner's GitHub credentials (if provided in your session) are used as given and never written anywhere — no remote URLs with tokens, no logs, no screenshots.

## 2. Off-limits areas (never change, in any phase)

- The secret-protection logic: how credentials are stored/encrypted/unlocked.
- The code that keeps copied secrets out of Windows clipboard history and cloud sync, and the clipboard-writing code (`internal/clipboard/`).
- Global hotkey registration code.
- The owner's real stored entries: never open, read, print, or screenshot the real vault. Test only with obviously fake values (`FAKE-TOKEN-123` style).
- Standing data protections: no destructive actions on data, no schema migrations beyond what the plan lists (the fragment format in Phase 4 is additive, not a migration), no real payments or customer messages.

If a fix seems to require touching an off-limits area, stop that task, record it in `PROGRESS.md` as "blocked — off-limits", and move on.

## 3. Resume rule

If `PROGRESS.md` shows earlier work from a previous run of your session, **continue at the first unfinished phase**. Never redo finished phases. Check the evidence folder (`evidence/after/`) for what screenshots already exist — take only the missing ones.

## 4. Run the plan, phase by phase, automatically

Work through Phases 1 → 12 in order, then R1 and R2. **Do not ask the owner for permission between phases.** The plan is the permission.

For **each phase**:
1. Do the tasks listed. If a task is impossible in your environment (e.g. needs Windows), do everything else, mark that task's verification "needs Windows smoke test" in `PROGRESS.md`, and move on.
2. Run the phase's **Verification** section, including a re-run of the relevant `01b-baseline.md` sections (always include canaries A2, A5, A7, B2, B18 — or note why not).
3. Confirm the **Milestone** is met — it is observable, not a feeling.
4. Update `PROGRESS.md`: phase status, what changed, evidence (file names), anything skipped and why.
5. Make **one commit** named `phase N: <goal>` containing **only the files you changed on purpose** (explicit paths). Push if a remote exists.
6. If the baseline reveals something that used to work and now does not: **fix it or revert the change before moving on.** Record what happened in `PROGRESS.md`.

When blocked on a task: write the blocker into `PROGRESS.md`, skip to the next independent task or phase, and report all blockers at the end. Never leave a phase half-committed — a phase either lands complete or is reverted.

## 5. Scope discipline

No changes outside the plan. If you discover something that genuinely must change for the plan to work, record it in `PROGRESS.md` under "Scope additions" with the reason, keep it minimal, and include it in that phase's commit. Existing behavior must keep working — the baseline is the contract. The plan's "Deferred and out of scope" section stays deferred.

## 6. Final re-audit (Phase R1) — required before release

1. Re-run every audit lens from `02-findings.md` over the changed areas; give every finding a final status in `PROGRESS.md`.
2. Re-run the **full** baseline `01b-baseline.md`.
3. Save after-screenshots to `docs/ui-audit/round-1/evidence/after/` using **the same screen names and sizes as the before set** (see `evidence/before/` — 34 images; modest sizes, under ~300 KB each, never showing real secrets; fake data only).
4. Write `docs/ui-audit/round-1/07-before-after.md`: a plain-language page pairing each before image with its after image, 1–2 sentences per pair on what changed and why it is better. The owner must be able to read this without knowing code.
5. Write `docs/ui-audit/round-1/06-next-focus.md`: your educated, labelled judgment of the NEXT round's focus — top 3–5 areas ranked with reasoning and confidence (high/medium/low); anything only checked by reading code that needs a real Windows run; deferred findings and why; new problems noticed while implementing; upgrade opportunities not done; and one short ready-to-paste focus line for starting the next round. Say "I am not sure" where true.

## 7. Release (Phase R2) — automatic, no permission asked

Only after all phases meet their milestones and R1 is complete:
1. Write the rollback plan into `PROGRESS.md` **before** deploying: what is live now (v1.2.0, tag `v1.2.0`), the exact undo steps (revert on `main` → bump to `v1.3.1` → tag + push; releases are append-only, clients self-update forward; never force-push tags), and the restore tags (`pre-ui-audit-round-1`, `pre-ui-upgrade-round-1`).
2. Run the project's checks: `cd frontend && bun run build && bun run test`, plus `gofmt -l .`, `go vet ./...` (or `GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go vet ./...` off-Windows), and `go test ./internal/...`. **Deploy only if they pass.**
3. Bump the version in all the places the release guard checks (`app.go` AppVersion, NSIS `VERSION`, `build/winres/info.json`, `frontend/src/lib/clavis/types.ts` APP_VERSION) → **v1.3.0**. Commit `release: v1.3.0` (explicit paths), push `main`, push tag `v1.3.0`. The tag-driven workflow (`.github/workflows/release.yml`) builds `Clavis-Setup-1.3.0.exe` + `Clavis-Portable-1.3.0.exe` and publishes the GitHub Release. Do not invent any other deploy method.
4. Write the release notes (plain language: what changed, the before/after doc link, and the owner's 5-minute Windows smoke-test checklist: hotkey popup, copy + Win+V exclusion, group JSON export→import round-trip, dark mode, window resize).
5. Check the live result: the release page exists with both assets; walk the baseline's main tasks against what you can run. Record the result in `PROGRESS.md`.
6. If the deploy or live check fails: roll back using your written plan and report the exact error. If you cannot deploy (no access, no workflow run), record exactly what is missing and finish everything else — never invent a deploy method.

## 8. Secrets

Keep tokens and passwords out of every file, commit, log, and screenshot. GitHub credentials given by the owner are used as provided and never written anywhere.

## 9. Closing summary

End your session with a plain-language report: what changed, what is live, how to undo it, and what the next round should focus on.
