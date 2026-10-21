# CLAVIS — Build Specification

Version 1.0 of this spec. Read the whole file before writing any code.
Companion file: `design-tokens.css` (all colors, glass, type, spacing, motion).

---

## 0. Rules for the agent (read first)

1. The owner is a non-technical designer. He cannot read or patch code. You must deliver a **fully working app end to end** with **no manual steps for him**.
2. **Do not ask him questions.** If something is unclear, pick the safest option consistent with this spec, and write the decision into `DECISIONS.md` (one line each: what was unclear, what you chose, why).
3. If a tool, library, or step fails, fix it yourself and continue. Only stop when the whole app builds, passes its tests, and both deliverables exist (section 9).
4. Install any missing prerequisites yourself (Go, Node.js LTS, NSIS, WebView2 runtime, Wails CLI). Prefer `winget` on Windows.
5. Never hard-code a color, font, radius, or spacing value in the UI. Everything comes from `design-tokens.css` variables.
6. Never log, print, or write secret values to the console, to log files, or to error messages. Item values appear only in the UI (when revealed) and in the data file.
7. Keep a running `BUILD_LOG.md` (short entries) so progress is traceable.
8. Every place this spec says "must" is mandatory. "Should" means do it unless it proves impossible, then log it in `DECISIONS.md`.

---

## 1. Product summary

**Clavis** (Latin for "key") is a tiny, ultra-fast Windows tray app. The owner runs 5–6 software projects in parallel and copy-pastes credentials (GitHub tokens, Cloudflare tokens, etc.), repeated prompts and notes 100+ times a day from scattered notepad files. Clavis stores them all in one place and puts any item on the clipboard in about two seconds: press a global shortcut, type a few letters, press Enter, done.

**Success metric:** shortcut press to "copied" in about 2 seconds and 3 keystrokes. The popup must appear in 150 ms or less.

**Two kinds of things:**
- **Item**: one value (a long token, a prompt, a note).
- **Group**: an ordered list of items under one name (for example "Sedanama credentials"). Copying a group puts all its items on the clipboard as `NAME=value` lines (.env style). A group holds only what the user puts into it. No type restrictions.

**Shared items:** one item can belong to many groups. Edit it once and every group sees the change (with a confirmation, section 5.6).

**Organization:** user-created categories (starter set: Credentials, Prompts, Notes), free-form tags, and one instant search across name, category and tag.

---

## 2. Platform and technology

- **Target:** Windows 10 (version 1809 or newer) and Windows 11. Windows only. 64-bit.
- **Framework: Wails v3** (Go backend + web frontend). Reason: v3 provides multiple windows and a system tray, which Clavis needs. As of this spec, v3 is in beta. **Pin the exact Wails v3 version** you use in `go.mod` and record it in `DECISIONS.md`. Read the official Wails v3 docs first (https://v3.wails.io and the status page) for the current API; do not rely on memory.
- **Frontend:** React + TypeScript + Vite. No CSS framework: plain CSS using the variables in `design-tokens.css`. Fonts bundled via npm (`@fontsource-variable/inter` and `@fontsource/jetbrains-mono`), never loaded from the internet.
- **Global hotkey:** Wails does not provide a system-wide hotkey. Use `golang.design/x/hotkey`, or Win32 `RegisterHotKey` through `golang.org/x/sys/windows` on a dedicated locked OS thread with a message loop. Verify it works while another app has focus.
- **Fallback plan** (use only if Wails v3 proves unusable after real attempts): Wails v2 (stable) as a single window that switches between "popup mode" and "manager mode" by resizing/re-positioning, plus `fyne.io/systray` for the tray icon. Log the switch in `DECISIONS.md`. The user-visible behavior must stay identical.
- **No network access at runtime.** The app must work fully offline and must never send data anywhere. No telemetry, no update checks, no analytics.
- **Windows 10 has no native blur.** Do **not** depend on Mica/Acrylic. Glass is created by the app itself (section 7).

---

## 3. Application behavior

### 3.1 Process model
- Clavis runs as a **background tray app**. On launch it creates two windows up front and keeps both hidden: the **Popup** and the **Manager**. Showing a pre-created window is what makes the popup instant. **Never create the popup on demand.**
- **Single instance.** If a second copy starts (for example installed and portable both launched), it must not run. It signals the first instance to open the Manager window and exits. Reason: two copies would fight over the shortcut and could damage the data file.
- **Start with Windows:** a Settings toggle, **on by default after the first run**. Implement with the `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` registry value, launching with a `--hidden` flag (tray only, no window). No admin rights needed.

### 3.2 Tray
- Tray icon: a simple key glyph in the primary blue, legible at 16×16, with light and dark variants if the API allows.
- Left click: show the Popup.
- Right click menu: **Open Clavis** (Manager), **Quick search** (Popup), **Pause shortcut / Resume shortcut**, **Quit**.
- Closing the Manager window (X) hides it to the tray. Only "Quit" exits the app.

### 3.3 Global shortcut
- Default: **Ctrl + Shift + Space**. The user changes it in Settings by pressing the new combination (a "press keys now" capture field). Must include at least one modifier. Persist in settings.
- If the shortcut cannot be registered (another app owns it), show a clear message in the Manager and in Settings ("This shortcut is used by another app. Choose a different one."). Never fail silently.
- Pressing the shortcut while the popup is open hides it (toggle).

### 3.3b Popup window behavior
- Frameless, transparent webview, always on top, no taskbar entry, skips the taskbar and Alt-Tab.
- Centered horizontally, positioned in the upper third of the screen the mouse cursor is on.
- Hides when it loses focus, and on Esc.
- Opens with the search box focused and the previous query cleared; every open starts from a clean state (query, selection, drill position and copy feedback are reset — a leftover copy state must never block typing).
- Size: 640 px wide panel (plus the shadow margin, see tokens). Height grows with the number of rows, up to 10 rows visible, then scrolls.
- The footer carries a clear **Open Clavis** button that closes the popup and shows the Manager window.
- The popup **never** shows secret values in full. See 5.2.

### 3.4 Manager window
- Normal resizable window, default 1000×680, minimum 760×520, frameless with a custom title bar drawn by the app (minimize, maximize, close), transparent webview, self-drawn rounded corners (Windows 10 frameless windows are square otherwise).
- Remembers its size and position.

---

## 4. Data and storage

### 4.1 Location (shared by installed and portable versions)
- Data folder: `%APPDATA%\Clavis\` (inside the Windows user profile).
- Main file: `clavis-data.json`.
- Backups: `%APPDATA%\Clavis\backups\`.
- Both the installed app and the portable app read this same file, so a version change never loses data and the portable app "finds its database automatically".
- If the folder or file does not exist, create it with the starter content (4.3).

### 4.2 File format (JSON, UTF-8, human-readable, indented)

```json
{
  "schemaVersion": 1,
  "appVersion": "1.0.0",
  "encryption": { "enabled": false },
  "settings": {
    "shortcut": "Ctrl+Shift+Space",
    "startWithWindows": true,
    "solidMode": false,
    "glassIntensity": 100,
    "showLast4": true,
    "managerBounds": { "x": 0, "y": 0, "w": 1000, "h": 680 }
  },
  "categories": [ { "id": "…", "name": "Credentials", "sortOrder": 0 } ],
  "items": [ {
    "id": "…", "name": "GitHub token", "key": "GITHUB_TOKEN",
    "value": "…", "note": "", "categoryId": "…", "tags": ["github"],
    "isSecret": true, "pinned": false,
    "useCount": 0, "lastUsedAt": null,
    "createdAt": "ISO-8601", "updatedAt": "ISO-8601", "deletedAt": null
  } ],
  "groups": [ {
    "id": "…", "name": "Sedanama credentials", "categoryId": "…", "tags": [],
    "itemIds": ["…", "…"], "pinned": false,
    "useCount": 0, "lastUsedAt": null,
    "createdAt": "ISO-8601", "updatedAt": "ISO-8601", "deletedAt": null
  } ]
}
```

- IDs: UUID v4 or ULID.
- **Groups store references (`itemIds`), not copies.** This is the core of shared items. It must be in the first version.
- `key` is the variable name used when a group is copied as `NAME=value`. Auto-generate from the name (uppercase, spaces and symbols to underscores, for example "GitHub token" → `GITHUB_TOKEN`). The user can edit it. If two items in the same group share a key, append `_2`, `_3` automatically.
- `encryption.enabled` is always `false` in v1. It exists so a master password can be added later without changing the format.
- Tags are plain strings stored on items and groups; the tag list is derived. Tags are case-insensitive for matching; store as typed.
- `isSecret` defaults to `true` for items created in the Credentials category, `false` otherwise; the user can toggle it per item.

### 4.3 Starter content (first run only)
Create three categories: **Credentials**, **Prompts**, **Notes**. No sample items. The user can rename or delete them.

### 4.4 Safe writing, backups, migration
- **Atomic writes:** write to `clavis-data.json.tmp`, flush, then rename over the real file. Never leave a half-written file.
- One writer: all writes go through a single mutex-protected store in Go. The frontend never touches the file.
- **Automatic backups:** copy the data file into `backups\` (a) once per day on the first change of that day, and (b) always before any migration or import. Keep the newest 10 daily backups plus every pre-migration/pre-import backup from the last 30 days. Name: `clavis-data-YYYYMMDD-HHMMSS.json`.
- **Migration:** on load, if `schemaVersion` is lower than the app's, back up first, then migrate step by step. If it is **higher** than the app understands, do not touch the file: show "This data was created by a newer version of Clavis. Please update the app." and run read-only.
- **Corrupt file recovery:** if the file cannot be parsed, automatically restore the newest valid backup, keep the broken file as `clavis-data.broken-<timestamp>.json`, and tell the user in a visible banner.
- **Trash:** deleting is a soft delete (`deletedAt`). Trash items are purged 30 days after deletion (check on startup).

---

## 5. Features in detail

### 5.1 Search (instant, in the frontend)
- The full data set is small, so the frontend keeps an in-memory copy (refreshed on a change event from Go) and filters on every keystroke with no debounce.
- One search box. Matching rules, all combined with AND:
  - Plain words match **name**, **key**, **note**, **category name** and **tag names** (case-insensitive, prefix and fuzzy-subsequence match; for example "ghtk" finds "GitHub token").
  - `#word` restricts to items/groups whose tags match.
  - `@word` restricts to a category.
- Ranking: exact/prefix name match first, then pinned, then most-used (`useCount`, then `lastUsedAt`).
- Search never looks inside **secret values**.
- With an empty query, the popup shows a **Recent** section first — the **10 most recently used/copied entries** (items AND groups; copying a whole group counts as using it), most recent first. When fewer than 10 entries have ever been used, the list is topped up with a **Pinned & frequent** section (pinned first, then most-used) so the palette always offers up to 10 rows.
- The Manager sidebar has a matching **Recent** view: the same 10 most recently used/copied entries, most recent first.
- If nothing matches: show "Nothing found. Press Enter to create '<query>'", and Enter opens the Manager's new-item form with the name prefilled.

### 5.2 Popup rows and copy behavior
Each row shows: type icon (key = secret item, lines = note or prompt, stack = group), bold name, muted "category · tags", and on the right either the masked preview (`••••••••3f9a`, last 4 characters when `showLast4` is on and the value is at least 12 characters, otherwise fully masked) or "12 items" for groups.

Keyboard (the popup is keyboard-first):
- Up/Down: move selection. Mouse hover also selects; click = Enter.
- **Enter:** copy the selected row. Single item → the value exactly as stored. Group → every member as `KEY=value`, one per line, in group order.
- **Right arrow:** open a group and list its members. **Enter** on a member copies only that member. **Ctrl+Enter** copies the whole group. **Left arrow / Backspace on empty query / Esc** goes back one level. Esc at top level hides the popup.
- **Ctrl+N:** open the Manager with a new item form. **Ctrl+E:** open the Manager on the selected row.
- Dotenv quoting for group copy: if a value contains a newline, a double quote, a backslash, or leading/trailing spaces, write it as `KEY="…"` with `\n`, `\"` and `\\` escapes. Otherwise write it plain.

After a copy:
1. The row briefly turns into a "✓ Copied" state (for a group: "✓ Copied 12 lines"), using `--color-success-text` plus the check icon.
2. After about 500 ms the popup hides.
3. Increment `useCount`, set `lastUsedAt`.

**Clipboard privacy (must):** when copying a secret item or any group containing a secret, also set the Windows clipboard formats that tell Windows not to keep it: `ExcludeClipboardContentFromMonitorProcessing`, `CanIncludeInClipboardHistory` = 0 and `CanUploadToCloudClipboard` = 0. This keeps tokens out of Win+V clipboard history and cloud clipboard sync. If it cannot be done, log it in `DECISIONS.md`.

### 5.3 Manager window layout (three columns)
1. **Sidebar:** All, Pinned, Categories (with counts, plus "+" to add one; rename and delete via a small menu), Tags (list, click to filter), Trash, and at the bottom Settings.
2. **List:** search box on top (same rules as 5.1, but secret values stay hidden), a **New** button (menu: New item, New group), then items and groups mixed, each with its icon. Shared items show a link icon with a count (for example `🔗 5`) as an icon plus number, never color alone.
3. **Detail/editor** for the selected thing.

Adding an item must take one short form: name, value (multi-line), category, tags, optional note, and the secret/pin toggles. **Enter saves** (Ctrl+Enter inside the multi-line value field).

### 5.4 Item editor
- Fields: name, key (shown only when the item belongs to a group or the user expands "Advanced"), value, category (dropdown, can create new inline), tags (chips with autocomplete), note, "Secret" toggle, "Pinned" toggle.
- Value display: if `isSecret`, show dots with an eye button to reveal; clicking again hides. Revealed state resets when the selection changes or the window hides. A small hint under the value field reads **Enter saves · Ctrl+Enter adds a line** (the keyboard behavior lives where the typing happens — never in the action bar).
- The secret/pinned toggles sit in an equal-width two-column grid (one column on narrow panes) so they stay vertically aligned.
- A **Used in** list shows every group containing this item (click to jump to the group).
- Action bar (bottom, anchored by a hairline divider): **Save** (left, only when dirty) and **Cancel** (left, create mode); **Copy**, **Duplicate**, and a **⋯ menu** (right) holding Export Markdown, Export Text, and **Delete item** (danger, below a divider — same pattern as the group editor). Delete never appears as a standalone red button in the bar itself.

### 5.5 Group editor
- Fields: name, category, tags, pinned.
- Member list in order, drag to reorder. Each row shows name, key, masked preview, shared marker, and an **×** that **removes it from this group** (not delete). The × tooltip reads "Remove from group".
- **Add item** button: a search field over existing items (pick one or several) plus "Create new item here" that opens the item form and adds it to the group on save. One-click adds, no extra steps.
- **Copy group** button (copies the `KEY=value` block).
- Deleting a group never deletes its items; they remain as standalone items.

### 5.6 Editing and deleting shared items
Only when an item belongs to **two or more groups** do these modals appear. For items in one group or none, edits and deletes happen immediately with no modal.

**Saving an edited shared item** (when it is edited from within a group context) → modal titled "This item is used in N groups", listing the group names, with three buttons labeled by what they do:
1. **Update everywhere (N groups)**: primary.
2. **Only for "<current group>" (keep a separate copy)**: creates a new item with the new value (same name, key, category, tags), and replaces the reference **in that group only**. The original keeps the old value in the other groups.
3. **Cancel**.

If the same edit is made from the item's own detail view (no current group), show only **Update everywhere** and **Cancel**.

**Deleting a shared item** → modal: "This item is used in N groups: …" with **Delete everywhere** (danger fill) and **Cancel**. Removing it from one group (the × in the group editor) never shows this modal.

### 5.7 Delete, undo, trash (the safe path is the easy path)
- No "Are you sure?" dialogs, except the shared-item modals above and "Replace everything" on import.
- Every delete is immediate and shows a toast at the bottom of the window: "Deleted 'GitHub token' · **Undo**" for about 8 seconds. Undo restores it exactly (including group memberships).
- Deleted things go to **Trash** (sidebar), where each can be **Restored** or **Deleted forever**. "Empty trash" also exists.

### 5.8 Import and export
All of it lives in **Settings → Data** (and Export/Import also appear in the item and group menus).

**A. Full backup (everything, exact):**
- **Export everything** saves `clavis-backup-YYYYMMDD-HHMM.json` (a copy of the data file) to a place chosen with the standard Windows Save dialog.
- **Import backup** (JSON): ask **Replace everything** (a back-up of the current data is made first; show a confirmation naming what will be replaced) or **Merge** (add things whose id is missing, and when an id exists on both sides keep the one with the newer `updatedAt`). Show a result summary ("Added 12, updated 3, skipped 2").
- This is the manual safety net for moving between versions or computers.

**B. Markdown / TXT for single things:**
- **Export an item or a group**, user picks **Markdown (.md)** or **Text (.txt)**.
- Item `.md`:
  ```
  ---
  type: item
  name: GitHub token
  key: GITHUB_TOKEN
  category: Credentials
  tags: [github, ci]
  secret: true
  ---
  <the value, exactly as stored, multi-line allowed>
  ```
- Group `.md`:
  ```
  ---
  type: group
  name: Sedanama credentials
  category: Credentials
  tags: [sedanama]
  ---
  GITHUB_TOKEN=<value>
  CLOUDFLARE_API_TOKEN=<value>
  ```
  (dotenv quoting rules from 5.2 apply.)
- `.txt` export: item = the value only; group = the `KEY=value` lines only.
- **Export all as Markdown:** a folder picker; one `.md` file per item and per group (file name from the name, made filesystem-safe).
- **Import** accepts `.md` and `.txt`, one or many files at once (also a whole folder). `.md` is read by its header. A `.txt` with `KEY=value` lines imports as a group (named after the file), each line becoming an item; any other `.txt` imports as a single item named after the file.
- **Duplicate handling:** when an imported name or key already exists, ask once per conflict: **Reuse existing** or **Keep both**, with an "Apply to all" checkbox. Nothing duplicates silently.
- Warn (a one-line note under the export buttons): "Exported files contain your real secrets in plain text. Keep them out of project folders you commit to Git."

### 5.9 Settings screen
- Shortcut (key capture) and the message when it is taken.
- Start with Windows (toggle).
- **Glass intensity** slider (0–100, scales the glass opacity and blur) and **Solid mode** toggle. Solid mode also switches on automatically when Windows "Transparency effects" is off (read `HKCU\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize\EnableTransparency`).
- Show last 4 characters in masked previews (toggle).
- **Data:** Export everything, Import, Open data folder, list of backups with a **Restore** button each.
- About: app name, version, data folder path.

### 5.10 Empty and error states
- First run, no items: friendly empty state in the Manager with two buttons, **Add your first item** and **Import**.
- Popup with no data: "Nothing here yet. Press Ctrl+N to add your first item."
- Corrupt data: the recovery banner from 4.4.
- Newer data than the app understands: the read-only message from 4.4.
- Shortcut conflict: see 3.3.

---

## 6. Security posture (v1)

- Data is stored **in plain text** in v1 (the owner's explicit choice). The file lives only in the user's profile folder.
- Because of this: never log values, never put values in window titles, never put values in the tray tooltip, never expose them through any network call.
- The clipboard exclusion in 5.2 is mandatory.
- Master password and encryption are **out of scope for v1**; the `encryption` block in the file is the hook for it.

---

## 7. Visual design (use `design-tokens.css`)

**Style: dark glassmorphism, white + blue.** Glass cards float over an ambient dark-blue backdrop that the app draws itself (this works on Windows 10; do not use OS blur).

- The window is transparent and frameless. The app draws a panel with `--radius-panel` and the shadow from the tokens, inside a transparent margin of `--window-shadow-pad` so the shadow is never clipped.
- **Backdrop:** `--backdrop-image` on the panel's background layer.
- **Glass surfaces:** use the `.glass-panel` recipe from the tokens. **Blur only on the outer panel(s)** (popup panel; manager sidebar/detail panels). Rows, chips, and inputs are flat translucent fills with no blur. Never stack more than two blur layers. This is a performance rule: the popup must stay at 150 ms or less.
- **Hierarchy through depth, not decoration:** panel > raised rows. Selected row = `--glass-bg-selected` fill **plus** a 3 px left bar in `--selected-bar`. Never signal state by color alone; always pair with an icon, bar, or label.
- **Contrast rules (verified in the tokens):** body text `--text`; secondary text `--text-muted`; accent text and icons use `--color-accent-text`. **Never use `--color-primary` blue as text on glass** (it fails contrast); it is for fills, bars and buttons only. Buttons: primary = `--color-primary` fill with `--text-on-primary`; danger = `--color-danger-fill` with white text.
- **Glows are capped** (`--backdrop-glow-*` caps in the tokens). Do not raise them.
- **Type:** UI text in `--font-ui` (never lighter than regular weight on glass); all secret values, keys, prompts and notes in `--font-mono`. Auto-detect text direction per item (`dir="auto"`) so Farsi/RTL prompts and notes display correctly.
- **Motion:** only functional. Popup appears with a ≤100 ms fade (`--motion-popup-in`); toasts ≤150 ms. Respect `prefers-reduced-motion`.
- **Solid mode:** adding class `solid` on `<html>` swaps glass for the solid surfaces in the tokens (automatic when Windows transparency is off, or when toggled in Settings).
- **Footer hint bar in the popup:** `↵ Copy   → Open group   Esc Close` (keycap-style hints), always visible. This is recognition over recall.
- **Dark only in v1.** No light theme.
- **Focus:** every interactive control has a visible focus ring (`--focus-ring`). Everything in the popup works with the keyboard alone.
- **Icons:** one consistent outline icon set (for example `lucide-react`), bundled.

---

## 8. Code structure (guidance)

- `main.go`: app setup, windows, tray, single-instance, hotkey.
- `internal/store/`: data model, load/save, atomic write, backups, migration, trash purge. **Pure Go with unit tests.**
- `internal/search/`: search and ranking logic (mirrored in the frontend; keep one documented algorithm and test it).
- `internal/exchange/`: Markdown/TXT/JSON import and export, dotenv quoting. **Unit tests.**
- `internal/clipboard/`: Windows clipboard with the exclusion formats.
- `internal/system/`: autostart registry value, transparency detection, hotkey.
- `frontend/`: React app with two entry views (`popup`, `manager`) sharing components and `design-tokens.css`.
- Frontend never reads or writes files directly; everything goes through Go-bound methods.

---

## 9. Build, packaging and deliverables

Produce, in a `dist/` folder at the project root:

1. **`Clavis-Setup-<version>.exe`**: an installer (NSIS through the Wails packaging tooling). Per-user install (no admin rights needed), Start Menu shortcut, uninstaller. It must ensure the **WebView2 runtime** is present (bootstrap/install it if missing). The uninstaller must **not** delete `%APPDATA%\Clavis\`.
2. **`Clavis-Portable-<version>.exe`**: the same program as a single runnable file, no installation. It uses the same `%APPDATA%\Clavis\` data folder.
3. **`README.txt`**: plain-language, for a non-technical person: what each file is, how to install, how to set the shortcut, where the data lives, how to export a backup, how to move to a newer version (just run the new one; data is found automatically; or Import a backup).
4. **`DECISIONS.md`** and **`BUILD_LOG.md`**.

Also: an app icon (a simple blue key glyph, generated by you as SVG then converted to `.ico` with all standard sizes), version info embedded in the exe, product name "Clavis".

---

## 10. Testing and acceptance

You must run these yourself and fix failures. The owner will not.

**Automated tests (Go):**
- Store: create/edit/delete items, groups, categories; groups hold references; editing a shared item with "Update everywhere" changes all groups; "Only for this group" splits correctly; delete + undo + trash purge after 30 days.
- Atomic write: simulate a crash mid-write; the original file stays valid.
- Backups: daily backup created; pre-migration and pre-import backups created; retention works.
- Migration: a v1 file loads; a file with a higher schemaVersion opens read-only and is not modified; a corrupt file is recovered from the newest valid backup.
- Exchange: round-trip export then import for an item, a group, and a full backup, including values with newlines, quotes, backslashes, leading/trailing spaces, and Farsi text. Duplicate handling works.
- Search: name, key, category, tag, `#tag`, `@category`, fuzzy match, ranking, empty-query ordering. Secret values are never matched.
- Dotenv quoting for group copy.

**Behavior checks (run the real app and verify; automate what you can):**
- Shortcut opens the popup while another app has focus; popup appears in 150 ms or less (measure and log the time from key event to first paint; record it in `BUILD_LOG.md`).
- Type → Enter copies the right text; group copy yields correct `KEY=value` lines; the "✓ Copied" state shows; the popup hides.
- Secret copy is excluded from Windows clipboard history (verify the formats are set).
- Second launch does not start a second instance and instead opens the Manager.
- Quitting from the tray fully exits; closing the Manager only hides it.
- Start-with-Windows toggle writes and removes the registry value.
- Solid mode renders correctly; transparency-off auto-switch works.
- Installed and portable builds both open the same data file.
- Data survives an upgrade: build version A, add data, run version B, data is intact.

**Acceptance checklist (all must be true):**
- [ ] Popup opens by global shortcut in ≤150 ms and everything in it works with the keyboard alone.
- [ ] Shortcut-to-copied is 3 keystrokes for a top result.
- [ ] Items, groups, categories, tags and search all work as specified.
- [ ] Shared items: one edit updates every group, with the correct three-button modal.
- [ ] Undo works for every delete; Trash restores; nothing is lost by accident.
- [ ] Full backup export/import and per-item/group Markdown/TXT import/export work and round-trip.
- [ ] Data is in `%APPDATA%\Clavis\`, shared by installer and portable builds, with automatic backups and corrupt-file recovery.
- [ ] Visual design matches section 7 and uses only token variables; text contrast stays AA.
- [ ] Both deliverables and `README.txt` exist in `dist/`.
- [ ] No secret value appears in any log or console output.

**Kill criteria (for the owner's later judgment, not for you):** if after two weeks he still opens the old notepad folders, or the shortcut-to-copied path feels slower than the old way.

---

## 11. Out of scope for v1 (do not build, but do not block)

Master password and encryption (hook: `encryption` block), auto-paste into the active window, clipboard auto-clear, any sync or cloud, browser extension, light theme, alternate (khaki) theme (hook: all colors are variables), macOS/Linux, sharing between users.
