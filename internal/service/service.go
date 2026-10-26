/**
 * CLAVIS — the pure dispatcher core (SPEC §5).
 *
 * Everything the frontend can ask for that does NOT need a window, dialog,
 * tray or the update network path lives here, free of Wails imports, so the
 * whole action surface is unit-testable on any platform. The Windows shell
 * (app.go) delegates to this and injects the two OS hooks it needs
 * (shortcut re-registration, autostart registry sync).
 *
 * Exposed surface (mirrors the reference API one-to-one):
 *   GetState()                    → full snapshot (+ osTransparency)
 *   Dispatch(action, payloadJSON) → the action dispatcher. The "copy"
 *                                 action writes the clipboard itself, with
 *                                 the store's privacy verdict (SPEC §5.2).
 *
 * SECURITY: item values are never logged; dialogs carry file names only.
 */
package service

import (
	"encoding/json"
	"strings"
	"sync"
	"unicode/utf16"

	"clavis/internal/clipboard"
	"clavis/internal/store"
	"clavis/internal/system"
)

// shortcutTakenMessage is the §3.3 conflict message.
const shortcutTakenMessage = "This shortcut is used by another app. Choose a different one."

// StateEnvelope is the state snapshot plus the OS transparency flag (§5.9).
// Item VALUES ARE REDACTED: the UI receives "" plus a valueLast4 hint under
// the §5.2 rule (only when showLast4 is on and the value is ≥12
// UTF-16 units). The edit form fetches one value on demand via getValue.
type StateEnvelope struct {
	UIState         uiVaultData        `json:"data"`
	Backups         []store.BackupInfo `json:"backups"`
	ReadOnly        bool               `json:"readOnly"`
	ReadOnlyReason  *string            `json:"readOnlyReason"`
	RecoveredNotice *string            `json:"recoveredNotice"`
	DataDir         string             `json:"dataDir"`
	AppVersion      string             `json:"appVersion"`
	OSTransparency  bool               `json:"osTransparency"`
}

// uiItem is the frontend view of an item: the embedded fields pass through,
// but Value is shadowed to "" and valueLast4 carries the masked hint.
type uiItem struct {
	store.Item
	Value      string `json:"value"`                // always "" in state
	ValueLast4 string `json:"valueLast4,omitempty"` // §5.2 rule
}

// uiVaultData mirrors store.VaultData with redacted items.
type uiVaultData struct {
	SchemaVersion int              `json:"schemaVersion"`
	AppVersion    string           `json:"appVersion"`
	Encryption    store.Encryption `json:"encryption"`
	Settings      store.Settings   `json:"settings"`
	Categories    []store.Category `json:"categories"`
	Items         []uiItem         `json:"items"`
	Groups        []store.Group    `json:"groups"`
}

// last4PerRule implements the §5.2 masked-preview rule: expose the last
// 4 characters only when showLast4 is on and the value is at least 12
// characters long. UTF-16 code units are used so the hint matches what the
// webview used to compute on its own.
func last4PerRule(value string, show bool) string {
	if !show {
		return ""
	}
	units := utf16.Encode([]rune(value))
	if len(units) < 12 {
		return ""
	}
	return string(utf16.Decode(units[len(units)-4:]))
}

// redactState converts a store snapshot into the UI envelope (values out).
func redactState(st store.State, transparencyOn bool) StateEnvelope {
	items := make([]uiItem, len(st.Data.Items))
	for i := range st.Data.Items {
		it := st.Data.Items[i]
		v := it.Value
		it.Value = ""
		items[i] = uiItem{Item: it, Value: "", ValueLast4: last4PerRule(v, st.Data.Settings.ShowLast4)}
	}
	groups := st.Data.Groups
	if groups == nil {
		groups = []store.Group{}
	}
	cats := st.Data.Categories
	if cats == nil {
		cats = []store.Category{}
	}
	return StateEnvelope{
		UIState: uiVaultData{
			SchemaVersion: st.Data.SchemaVersion,
			AppVersion:    st.Data.AppVersion,
			Encryption:    st.Data.Encryption,
			Settings:      st.Data.Settings,
			Categories:    cats,
			Items:         items,
			Groups:        groups,
		},
		Backups:         st.Backups,
		ReadOnly:        st.ReadOnly,
		ReadOnlyReason:  st.ReadOnlyReason,
		RecoveredNotice: st.RecoveredNotice,
		DataDir:         st.DataDir,
		AppVersion:      st.AppVersion,
		OSTransparency:  transparencyOn,
	}
}

// osTransparency is a test seam over system.TransparencyEnabled (the flag
// is part of stateMap's cache key and must be flippable in tests).
var osTransparency = system.TransparencyEnabled

// Service is the pure dispatcher core. RegisterShortcut and SyncAutostart
// are injected by the Windows shell (nil = no-op, like a missing runtime).
type Service struct {
	Store            *store.Store
	RegisterShortcut func(combo string) error
	SyncAutostart    func(enabled bool) error

	// writeClipboard is a test seam over clipboard.WriteText (nil = real).
	writeClipboard func(text string, secret bool) bool

	/* stateMap memoization: the JSON snapshot used to be re-serialized on
	   EVERY dispatched action (done() embeds it in each response). It is now
	   keyed on the store's snapshot generation plus the OS transparency
	   flag, so unchanged state is served from cache. cacheMu guards the
	   three fields below; the cached map is shared read-only — Wails only
	   serializes it. */
	cacheMu   sync.Mutex
	cacheKey  uint64 // store.Version() at cache time
	cacheOS   bool   // transparency flag at cache time
	cacheSnap map[string]any
}

// writeToClipboard puts text on the clipboard; secret payloads also set the
// Windows privacy formats that keep them out of clipboard history and cloud
// sync (§5.2).
func (s *Service) writeToClipboard(text string, containsSecret bool) bool {
	if s.writeClipboard != nil {
		return s.writeClipboard(text, containsSecret)
	}
	return clipboard.WriteText(text, containsSecret)
}

// GetState returns the full snapshot for the frontend.
func (s *Service) GetState() StateEnvelope {
	return redactState(s.Store.State(), osTransparency())
}

func (s *Service) stateMap() map[string]any {
	key := s.Store.Version()
	osT := osTransparency()
	s.cacheMu.Lock()
	defer s.cacheMu.Unlock()
	if s.cacheSnap != nil && s.cacheKey == key && s.cacheOS == osT {
		return s.cacheSnap
	}
	st := s.GetState()
	b, err := json.Marshal(st)
	if err != nil {
		return map[string]any{}
	}
	var m map[string]any
	if err := json.Unmarshal(b, &m); err != nil {
		return map[string]any{}
	}
	s.cacheKey, s.cacheOS, s.cacheSnap = key, osT, m
	return m
}

// Dispatch is the single frontend entry point: action + JSON payload.
func (s *Service) Dispatch(action, payloadJSON string) map[string]any {
	var payload map[string]any
	if strings.TrimSpace(payloadJSON) != "" {
		if err := json.Unmarshal([]byte(payloadJSON), &payload); err != nil {
			return Fail("Invalid request body.", 400)
		}
	}
	if payload == nil {
		payload = map[string]any{}
	}
	return s.dispatch(action, payload)
}

// Fail is the shared error envelope (used by the shell's dialog methods too).
func Fail(msg string, status int) map[string]any {
	return map[string]any{"ok": false, "error": msg, "status": status}
}

// FailErr wraps an error, mapping "newer version" to status 409.
func FailErr(err error) map[string]any {
	msg := err.Error()
	status := 400
	if strings.Contains(msg, "newer version") {
		status = 409
	}
	return Fail(msg, status)
}

func (s *Service) done(extras map[string]any) map[string]any {
	out := map[string]any{"ok": true}
	for k, v := range extras {
		out[k] = v
	}
	out["state"] = s.stateMap()
	return out
}

func getStr(p map[string]any, key string) string {
	if v, ok := p[key].(string); ok {
		return v
	}
	return ""
}

func getStrPtr(p map[string]any, key string) *string {
	v, ok := p[key]
	if !ok || v == nil {
		return nil
	}
	s, _ := v.(string)
	if s == "" {
		return nil // treat "" as "no category"
	}
	return &s
}

func getBool(p map[string]any, key string) *bool {
	if v, ok := p[key].(bool); ok {
		return &v
	}
	return nil
}

func getInt(p map[string]any, key string) *int {
	if v, ok := p[key].(float64); ok {
		i := int(v)
		return &i
	}
	return nil
}

func getStrArr(p map[string]any, key string) []string {
	arr, ok := p[key].([]any)
	if !ok {
		return nil
	}
	out := make([]string, 0, len(arr))
	for _, x := range arr {
		if s, ok := x.(string); ok {
			out = append(out, s)
		}
	}
	return out
}

func subMap(p map[string]any, key string) map[string]any {
	if m, ok := p[key].(map[string]any); ok {
		return m
	}
	return map[string]any{}
}

func (s *Service) dispatch(action string, p map[string]any) map[string]any {
	switch action {
	case "createItem":
		{
			input := subMap(p, "input")
			item, err := s.Store.CreateItem(store.NewItem{
				Name:       getStr(input, "name"),
				Value:      getStr(input, "value"),
				Key:        getStr(input, "key"),
				Note:       getStr(input, "note"),
				CategoryID: getStrPtr(input, "categoryId"),
				Tags:       getStrArr(input, "tags"),
				IsSecret:   getBool(input, "isSecret"),
				Pinned:     deref(getBool(input, "pinned")),
			})
			if err != nil {
				return FailErr(err)
			}
			return s.done(map[string]any{"id": item.ID})
		}
	case "updateItem":
		{
			patch := subMap(p, "patch")
			err := s.Store.UpdateItem(getStr(p, "id"), store.ItemPatch{
				Name:       strPtrOf(getStr(patch, "name"), patch["name"] != nil),
				Key:        strPtrOf(getStr(patch, "key"), patch["key"] != nil),
				Value:      strPtrOf(getStr(patch, "value"), patch["value"] != nil),
				Note:       strPtrOf(getStr(patch, "note"), patch["note"] != nil),
				CategoryID: catPtrOf(patch),
				Tags:       tagsPtrOf(patch),
				IsSecret:   getBool(patch, "isSecret"),
				Pinned:     getBool(patch, "pinned"),
			})
			if err != nil {
				return FailErr(err)
			}
			return s.done(nil)
		}
	case "splitItemForGroup":
		{
			patch := subMap(p, "patch")
			copyItem, err := s.Store.SplitItemForGroup(getStr(p, "id"), getStr(p, "groupId"), store.ItemPatch{
				Name:       strPtrOf(getStr(patch, "name"), patch["name"] != nil),
				Key:        strPtrOf(getStr(patch, "key"), patch["key"] != nil),
				Value:      strPtrOf(getStr(patch, "value"), patch["value"] != nil),
				Note:       strPtrOf(getStr(patch, "note"), patch["note"] != nil),
				CategoryID: catPtrOf(patch),
				Tags:       tagsPtrOf(patch),
				IsSecret:   getBool(patch, "isSecret"),
				Pinned:     getBool(patch, "pinned"),
			})
			if err != nil {
				return FailErr(err)
			}
			return s.done(map[string]any{"id": copyItem.ID})
		}
	case "duplicateItem":
		{
			copyItem, err := s.Store.DuplicateItem(getStr(p, "id"))
			if err != nil {
				return FailErr(err)
			}
			return s.done(map[string]any{"id": copyItem.ID})
		}
	case "createGroup":
		{
			input := subMap(p, "input")
			group, err := s.Store.CreateGroup(store.NewGroup{
				Name:       getStr(input, "name"),
				CategoryID: getStrPtr(input, "categoryId"),
				Tags:       getStrArr(input, "tags"),
				Pinned:     deref(getBool(input, "pinned")),
				ItemIDs:    getStrArr(input, "itemIds"),
			})
			if err != nil {
				return FailErr(err)
			}
			return s.done(map[string]any{"id": group.ID})
		}
	case "createGroupFromEnv":
		{
			input := subMap(p, "input")
			group, err := s.Store.CreateGroupFromEnv(store.NewGroup{
				Name:       getStr(input, "name"),
				CategoryID: getStrPtr(input, "categoryId"),
				Tags:       getStrArr(input, "tags"),
				Pinned:     deref(getBool(input, "pinned")),
			}, getStr(input, "text"))
			if err != nil {
				return FailErr(err)
			}
			return s.done(map[string]any{"id": group.ID})
		}
	case "updateGroup":
		{
			patch := subMap(p, "patch")
			err := s.Store.UpdateGroup(getStr(p, "id"), store.GroupPatch{
				Name:       strPtrOf(getStr(patch, "name"), patch["name"] != nil),
				CategoryID: catPtrOf(patch),
				Tags:       tagsPtrOf(patch),
				Pinned:     getBool(patch, "pinned"),
			})
			if err != nil {
				return FailErr(err)
			}
			return s.done(nil)
		}
	case "addItemsToGroup":
		{
			itemIds := getStrArr(p, "itemIds")
			if itemIds == nil {
				itemIds = []string{}
			}
			if err := s.Store.AddItemsToGroup(getStr(p, "groupId"), itemIds); err != nil {
				return FailErr(err)
			}
			return s.done(nil)
		}
	case "removeItemFromGroup":
		{
			if err := s.Store.RemoveItemFromGroup(getStr(p, "groupId"), getStr(p, "itemId")); err != nil {
				return FailErr(err)
			}
			return s.done(nil)
		}
	case "reorderGroupItems":
		{
			itemIds := getStrArr(p, "itemIds")
			if itemIds == nil {
				itemIds = []string{}
			}
			if err := s.Store.ReorderGroupItems(getStr(p, "groupId"), itemIds); err != nil {
				return FailErr(err)
			}
			return s.done(nil)
		}
	case "deleteEntry":
		{
			token, err := s.Store.DeleteEntry(store.EntryKind(getStr(p, "kind")), getStr(p, "id"))
			if err != nil {
				return FailErr(err)
			}
			return s.done(map[string]any{"undoToken": token})
		}
	case "undoDelete":
		{
			if err := s.Store.UndoDelete(getStr(p, "undoToken")); err != nil {
				return FailErr(err)
			}
			return s.done(nil)
		}
	case "restoreEntry":
		{
			if err := s.Store.RestoreEntry(store.EntryKind(getStr(p, "kind")), getStr(p, "id")); err != nil {
				return FailErr(err)
			}
			return s.done(nil)
		}
	case "purgeEntry":
		{
			if err := s.Store.PurgeEntry(store.EntryKind(getStr(p, "kind")), getStr(p, "id")); err != nil {
				return FailErr(err)
			}
			return s.done(nil)
		}
	case "emptyTrash":
		{
			if err := s.Store.EmptyTrash(); err != nil {
				return FailErr(err)
			}
			return s.done(nil)
		}
	case "createCategory":
		{
			cat, err := s.Store.CreateCategory(getStr(p, "name"))
			if err != nil {
				return FailErr(err)
			}
			return s.done(map[string]any{"id": cat.ID})
		}
	case "renameCategory":
		{
			if err := s.Store.RenameCategory(getStr(p, "id"), getStr(p, "name")); err != nil {
				return FailErr(err)
			}
			return s.done(nil)
		}
	case "deleteCategory":
		{
			if err := s.Store.DeleteCategory(getStr(p, "id")); err != nil {
				return FailErr(err)
			}
			return s.done(nil)
		}
	case "updateSettings":
		{
			return s.updateSettings(subMap(p, "patch"))
		}
	case "copy":
		{
			kind := store.EntryKind(getStr(p, "kind"))
			id := getStr(p, "id")
			result, err := s.Store.Copy(kind, id)
			if err != nil {
				return FailErr(err)
			}
			// Write the clipboard HERE, with the store's privacy verdict, so a
			// secret payload always carries the §5.2 exclusion formats no
			// matter which window asked — and the value itself never crosses
			// to the webview. The response carries metadata only.
			copied := s.writeToClipboard(result.Text, result.ContainsSecret)
			// The used counter tracks successful copies only: a failed
			// clipboard write must not bump useCount/lastUsedAt. MarkUsed is
			// deliberately best-effort AFTER a successful write — a stats
			// save failure must not fail a payload already on the clipboard.
			if copied {
				_ = s.Store.MarkUsed(kind, id)
			}
			return s.done(map[string]any{
				"copied":         copied,
				"lineCount":      result.LineCount,
				"containsSecret": result.ContainsSecret,
			})
		}
	case "getValue":
		{
			// One-item value fetch for the edit form (the state snapshot is
			// redacted; §5.4 reveal/edit needs exactly this one value).
			value, err := s.Store.ItemValue(getStr(p, "id"))
			if err != nil {
				return FailErr(err)
			}
			return map[string]any{"ok": true, "value": value}
		}
	case "importBackupPreview":
		{
			preview := s.Store.ImportBackupPreview(getStr(p, "json"))
			return map[string]any{"ok": true, "preview": map[string]any{
				"valid":    preview.Valid,
				"error":    preview.Error,
				"incoming": map[string]any{"items": preview.Items, "groups": preview.Groups, "categories": preview.Cats},
			}}
		}
	case "importBackup":
		{
			summary, err := s.Store.ImportBackup(getStr(p, "mode"), getStr(p, "json"))
			if err != nil {
				return FailErr(err)
			}
			return s.done(map[string]any{"summary": summaryMap(summary)})
		}
	case "importFilesPreview":
		{
			preview := s.Store.ImportFilesPreview(filesOf(p))
			return map[string]any{"ok": true, "preview": map[string]any{
				"conflicts":   preview.Conflicts,
				"parsedCount": preview.ParsedCount,
			}}
		}
	case "importFilesApply":
		{
			res := store.ImportResolution{Choice: "keepBoth"}
			if r, ok := p["resolution"].(map[string]any); ok {
				res.Choice = getStr(r, "choice")
				res.ApplyAll, _ = r["applyAll"].(bool)
				if pf, ok := r["perFile"].([]any); ok {
					for _, x := range pf {
						if m, ok := x.(map[string]any); ok {
							res.PerFile = append(res.PerFile, store.PerFileResolution{
								FileIndex: int(getFloat(m, "fileIndex")),
								Choice:    getStr(m, "choice"),
							})
						}
					}
				}
			}
			summary, err := s.Store.ImportFilesApply(filesOf(p), res)
			if err != nil {
				return FailErr(err)
			}
			return s.done(map[string]any{"summary": summaryMap(summary)})
		}
	case "restoreBackup":
		{
			if err := s.Store.RestoreBackup(getStr(p, "name")); err != nil {
				return FailErr(err)
			}
			return s.done(nil)
		}
	case "clearRecoveredNotice":
		{
			s.Store.ClearRecoveredNotice()
			return s.done(nil)
		}
	default:
		return Fail("Unknown action: "+action, 400)
	}
}

func summaryMap(s store.ImportSummary) map[string]any {
	return map[string]any{"added": s.Added, "updated": s.Updated, "skipped": s.Skipped}
}

func filesOf(p map[string]any) []store.ImportedFile {
	arr, ok := p["files"].([]any)
	if !ok {
		return nil
	}
	out := make([]store.ImportedFile, 0, len(arr))
	for _, x := range arr {
		if m, ok := x.(map[string]any); ok {
			out = append(out, store.ImportedFile{Name: getStr(m, "name"), Content: getStr(m, "content")})
		}
	}
	return out
}

func getFloat(p map[string]any, key string) float64 {
	if v, ok := p[key].(float64); ok {
		return v
	}
	return 0
}

func deref[T any](p *T) T {
	if p != nil {
		return *p
	}
	var zero T
	return zero
}

// strPtrOf returns a pointer only when the key was present (JSON null/absent
// means "don't touch"; "" means "clear").
func strPtrOf(v string, present bool) *string {
	if !present {
		return nil
	}
	return &v
}

// catPtrOf: absent/null → nil (keep); "" → treat as clear (nil below flag).
func catPtrOf(patch map[string]any) *string {
	v, ok := patch["categoryId"]
	if !ok || v == nil {
		return nil
	}
	s, _ := v.(string)
	return &s // including "" → applyItemPatch clears
}

func tagsPtrOf(patch map[string]any) *[]string {
	if _, ok := patch["tags"]; !ok {
		return nil
	}
	tags := getStrArr(patch, "tags")
	return &tags
}

// updateSettings applies the patch then the desktop side effects (hotkey
// re-registration, autostart) with rollback on failure.
func (s *Service) updateSettings(patch map[string]any) map[string]any {
	if len(patch) == 0 {
		return s.done(nil)
	}
	before := s.Store.State().Data.Settings

	glass := getInt(patch, "glassIntensity")
	mgrBounds, mgrSet := managerBoundsOf(patch)
	var err error
	if mgrSet {
		err = s.Store.UpdateSettings(store.SettingsPatch{
			Shortcut:         strPtrOf(getStr(patch, "shortcut"), patch["shortcut"] != nil),
			StartWithWindows: getBool(patch, "startWithWindows"),
			SolidMode:        getBool(patch, "solidMode"),
			GlassIntensity:   glass,
			ShowLast4:        getBool(patch, "showLast4"),
			ManagerBounds:    mgrBounds,
			ManagerBoundsSet: true,
		})
	} else {
		err = s.Store.UpdateSettings(store.SettingsPatch{
			Shortcut:         strPtrOf(getStr(patch, "shortcut"), patch["shortcut"] != nil),
			StartWithWindows: getBool(patch, "startWithWindows"),
			SolidMode:        getBool(patch, "solidMode"),
			GlassIntensity:   glass,
			ShowLast4:        getBool(patch, "showLast4"),
		})
	}
	if err != nil {
		return FailErr(err)
	}
	after := s.Store.State().Data.Settings

	// Shortcut changed → re-register the global hotkey (§3.3).
	if after.Shortcut != before.Shortcut {
		if err := s.registerShortcut(after.Shortcut); err != nil {
			// Roll back so the setting never points at a dead combo.
			old := before.Shortcut
			_ = s.Store.UpdateSettings(store.SettingsPatch{Shortcut: &old})
			_ = s.registerShortcut(old)
			return Fail(shortcutTakenMessage, 400)
		}
	}
	// Start-with-Windows changed → sync the registry (§3.1).
	if after.StartWithWindows != before.StartWithWindows {
		if err := s.syncAutostartHook(after.StartWithWindows); err != nil {
			// Roll back the toggle; the registry stays untouched.
			old := before.StartWithWindows
			_ = s.Store.UpdateSettings(store.SettingsPatch{StartWithWindows: &old})
			return Fail("Clavis could not change the “Start with Windows” setting. ("+err.Error()+")", 400)
		}
	}
	return s.done(nil)
}

func managerBoundsOf(patch map[string]any) (*store.ManagerBounds, bool) {
	v, ok := patch["managerBounds"]
	if !ok {
		return nil, false
	}
	if v == nil {
		return nil, true // clear
	}
	m, ok := v.(map[string]any)
	if !ok {
		return nil, false
	}
	b := &store.ManagerBounds{
		X: int(getFloat(m, "x")),
		Y: int(getFloat(m, "y")),
		W: int(getFloat(m, "w")),
		H: int(getFloat(m, "h")),
	}
	return b, true
}

// registerShortcut calls the injected shortcut hook (nil = nothing to do,
// mirroring the app==nil behavior of the Windows shell).
func (s *Service) registerShortcut(combo string) error {
	if s.RegisterShortcut == nil {
		return nil
	}
	return s.RegisterShortcut(combo)
}

// syncAutostartHook calls the injected autostart hook (nil = no-op success).
func (s *Service) syncAutostartHook(enabled bool) error {
	if s.SyncAutostart == nil {
		return nil
	}
	return s.SyncAutostart(enabled)
}
