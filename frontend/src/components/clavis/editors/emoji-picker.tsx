/**
 * CLAVIS — the emoji picker of the rich-text document editor (v1.15.0,
 * DECISIONS §57). Full pack: all 1,914 emojis of Unicode 15.1 in their nine
 * CLDR groups, with live search over the English names and a recents row.
 *
 * The dataset is a lazy Vite chunk (~400 KB JSON, unicode-emoji-json, MIT)
 * that loads the first time the picker opens — the app is fully offline.
 *
 * Split in two (v1.15.0, after the harness round): the trigger rides in the
 * toolbar, the PANEL is rendered by RichTextEditor against the editor's own
 * container — anchoring it to the 28px trigger wrapper squeezed the panel
 * to a sliver. The grid swallows mousedown so the caret never leaves the
 * editor; the insert path in RichTextEditor restores the saved selection
 * before execCommand("insertText").
 */
"use client";

import { useEffect, useMemo, useState } from "react";
import { Smile } from "lucide-react";
import { Ix } from "../icons";
import type { EmojiEntry, EmojiGroup } from "./emoji-types";

/** Short tab labels for the nine CLDR groups (dataset order). */
const GROUP_TABS: { title: string; short: string }[] = [
  { title: "Smileys & Emotion", short: "Smileys" },
  { title: "People & Body", short: "People" },
  { title: "Animals & Nature", short: "Animals" },
  { title: "Food & Drink", short: "Food" },
  { title: "Travel & Places", short: "Travel" },
  { title: "Activities", short: "Activities" },
  { title: "Objects", short: "Objects" },
  { title: "Symbols", short: "Symbols" },
  { title: "Flags", short: "Flags" },
];

const RECENTS_KEY = "clavis.recentEmoji";
const RECENTS_MAX = 24;

/* One dataset load per page: the panel unmounts on close, but the 400 KB
   chunk is fetched exactly once (the in-flight/loaded promise is cached at
   module level — reopening shows the grid on the next frame). */
let datasetPromise: Promise<EmojiGroup[]> | null = null;
function loadDataset(): Promise<EmojiGroup[]> {
  if (!datasetPromise) {
    datasetPromise = import("unicode-emoji-json/data-by-group.json").then((m) => m.default as EmojiGroup[]);
  }
  return datasetPromise;
}

function loadRecents(): string[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((e): e is string => typeof e === "string").slice(0, RECENTS_MAX);
  } catch {
    return [];
  }
}

function saveRecents(list: string[]): void {
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable (private mode) — recents just don't persist */
  }
}

/** The toolbar trigger. The panel itself is owned by RichTextEditor so it
 *  can span the editor's full width (see the file header). */
export function EmojiTrigger({ open, onToggle, disabled }: { open: boolean; onToggle: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      title="Emoji"
      aria-label="Insert an emoji"
      aria-haspopup="true"
      aria-expanded={open}
      /* mousedown is swallowed so the editor's selection survives the click */
      onMouseDown={(e) => e.preventDefault()}
      onClick={onToggle}
      className="clavis-btn clavis-btn-ghost clavis-tool"
    >
      <Ix icon={Smile} size="sm" />
    </button>
  );
}

export function EmojiPanel({ onInsert, onClose, flip }: { onInsert: (emoji: string) => void; onClose: () => void; flip?: boolean }) {
  const [groups, setGroups] = useState<EmojiGroup[] | null>(null);
  const [tab, setTab] = useState(0);
  const [query, setQuery] = useState("");
  const [recents, setRecents] = useState<string[]>([]);

  /* Recents load with the panel (localStorage is never touched on the
     closed path). */
  useEffect(() => {
    setRecents(loadRecents());
  }, []);

  /* The dataset loads once per page (module-level cache), on first open. */
  useEffect(() => {
    if (groups) return;
    let alive = true;
    void loadDataset().then((g) => {
      if (alive) setGroups(g);
    });
    return () => {
      alive = false;
    };
  }, [groups]);

  const search = query.trim().toLowerCase();
  const results: EmojiEntry[] = useMemo(() => {
    if (!groups) return [];
    if (search !== "") {
      const all: EmojiEntry[] = [];
      for (const g of groups) for (const e of g.emojis) all.push(e);
      return all.filter((e) => e.name.includes(search));
    }
    if (tab === -1) {
      /* Recents tab: map the stored characters back to their entries so the
         grid keeps names/labels. Unknown characters (dataset update) are
         skipped. */
      const byEmoji = new Map<string, EmojiEntry>();
      for (const g of groups) for (const e of g.emojis) byEmoji.set(e.emoji, e);
      return recents.map((r) => byEmoji.get(r)).filter((e): e is EmojiEntry => Boolean(e));
    }
    return groups[tab]?.emojis ?? [];
  }, [groups, search, tab, recents]);

  function pick(emoji: string) {
    onInsert(emoji);
    /* The recents write happens BEFORE the unmounting close() — a state
       updater would be dropped when the panel unmounts in the same batch
       (and side effects do not belong in updaters anyway). */
    const next = [emoji, ...recents.filter((e) => e !== emoji)].slice(0, RECENTS_MAX);
    saveRecents(next);
    setRecents(next);
    onClose();
  }

  return (
    <div className="clavis-emoji-panel" data-flip={flip === true ? "true" : "false"} role="dialog" aria-label="Emoji picker">
      <input
        type="search"
        className="glass-input"
        aria-label="Search emoji by name"
        placeholder="Search emoji…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        style={{ fontSize: "var(--text-sm)", padding: "var(--space-1) var(--space-2)" }}
      />
      {groups === null ? (
        <p className="t-muted" style={{ margin: 0, fontSize: "var(--text-sm)", padding: "var(--space-2)" }} role="status">
          Loading emojis…
        </p>
      ) : (
        <>
          <div className="clavis-emoji-tabs" role="tablist" aria-label="Emoji categories">
            {recents.length > 0 && search === "" ? (
              <button type="button" role="tab" aria-selected={tab === -1} onClick={() => setTab(-1)} className="clavis-emoji-tab">
                Recent
              </button>
            ) : null}
            {GROUP_TABS.map((g, i) => (
              <button
                key={g.title}
                type="button"
                role="tab"
                aria-selected={tab === i}
                onClick={() => setTab(i)}
                className="clavis-emoji-tab"
                title={g.title}
              >
                {g.short}
              </button>
            ))}
          </div>
          {results.length === 0 ? (
            <p className="t-muted" style={{ margin: 0, fontSize: "var(--text-sm)", padding: "var(--space-2)" }}>
              {search === "" ? "Nothing here yet — pick a few emojis first." : `No emoji matches “${query.trim()}”.`}
            </p>
          ) : (
            <div
              className="clavis-emoji-grid clavis-scroll"
              role="listbox"
              aria-label={search === "" ? (tab === -1 ? "Recent emoji" : GROUP_TABS[tab]?.title) : "Emoji search results"}
              onMouseDown={(e) => e.preventDefault()}
            >
              {results.map((e) => (
                <button
                  key={e.slug}
                  type="button"
                  role="option"
                  aria-selected={false}
                  title={e.name}
                  aria-label={`${e.name} emoji`}
                  onClick={() => pick(e.emoji)}
                  className="clavis-emoji-cell"
                >
                  {e.emoji}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
