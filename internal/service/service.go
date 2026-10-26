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

	"clavis/internal/clipboard"
	"clavis/internal/store"
	"clavis/internal/system"
)

// shortcutTakenMessage is the §3.3 conflict message.
const shortcutTakenMessage = "This shortcut is used by another app. Choose a different one."

// StateEnvelope is the state snapshot plus the OS transparency flag (§5.9).
type StateEnvelope struct {
	store.State
	OSTransparency bool `json:"osTransparency"`
}

// Service is the pure dispatcher core. RegisterShortcut and SyncAutostart
// are injected by the Windows shell (nil = no-op, like a missing runtime).
type Service struct {
	Store            *store.Store
	RegisterShortcut func(combo string) error
	SyncAutostart    func(enabled bool) error

	// writeClipboard is a test seam over clipboard.WriteText (nil = real).
	writeClipboard func(text string, secret bool) bool
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
	return StateEnvelope{
		State:          s.Store.State(),
		OSTransparency: system.TransparencyEnabled(),
	}
}

func (s *Service) stateMap() map[string]any {
	st := s.GetState()
	b, err := json.Marshal(st)
	if err != nil {
		return map[string]any{}
	}
	var m map[string]any
	json.Unmarshal(b, &m)
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
			result, err := s.Store.Copy(store.EntryKind(getStr(p, "kind")), getStr(p, "id"))
			if err != nil {
				return FailErr(err)
			}
			// Write the clipboard HERE, with the store's privacy verdict, so a
			// secret payload always carries the §5.2 exclusion formats no
			// matter which window asked — and the value itself never crosses
			// to the webview. The response carries metadata only.
			copied := s.writeToClipboard(result.Text, result.ContainsSecret)
			return s.done(map[string]any{
				"copied":         copied,
				"lineCount":      result.LineCount,
				"containsSecret": result.ContainsSecret,
			})
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
