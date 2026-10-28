/**
 * CLAVIS — lenient loading (mirrors the reference normalizeVault).
 *
 * Arbitrary parsed JSON is coerced into a valid VaultData; anything that does
 * not even look like a vault returns ok=false (corrupt-file path, §4.4).
 * SECURITY: values pass through; they are never logged here.
 */
package store

import (
	"strings"

	"github.com/google/uuid"
)

func normStr(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}

func normBool(v any, def bool) bool {
	if b, ok := v.(bool); ok {
		return b
	}
	return def
}

func normStrPtr(v any) *string {
	if s, ok := v.(string); ok {
		return &s
	}
	return nil
}

func normStrArr(v any) []string {
	arr, ok := v.([]any)
	if !ok {
		return []string{}
	}
	out := make([]string, 0, len(arr))
	for _, x := range arr {
		if s, ok := x.(string); ok {
			out = append(out, s)
		}
	}
	return out
}

// NormalizeVault coerces arbitrary parsed JSON into a valid VaultData.
func NormalizeVault(parsed any, appVersion string, nowISO string, newID func() string) (VaultData, bool) {
	raw, ok := parsed.(map[string]any)
	if !ok {
		return VaultData{}, false
	}
	sv, ok := raw["schemaVersion"].(float64)
	if !ok {
		return VaultData{}, false
	}
	if _, ok := raw["items"].([]any); !ok {
		return VaultData{}, false
	}
	if _, ok := raw["groups"].([]any); !ok {
		return VaultData{}, false
	}
	if _, ok := raw["categories"].([]any); !ok {
		return VaultData{}, false
	}

	settings := DefaultSettings()
	if sm, ok := raw["settings"].(map[string]any); ok {
		if s := normStr(sm["shortcut"]); strings.TrimSpace(s) != "" {
			settings.Shortcut = s
		}
		settings.StartWithWindows = normBool(sm["startWithWindows"], settings.StartWithWindows)
		settings.SolidMode = normBool(sm["solidMode"], settings.SolidMode)
		if gi, ok := sm["glassIntensity"].(float64); ok {
			g := int(gi)
			if g < 0 {
				g = 0
			}
			if g > 100 {
				g = 100
			}
			settings.GlassIntensity = g
		}
		settings.ShowLast4 = normBool(sm["showLast4"], settings.ShowLast4)
		if mb, ok := sm["managerBounds"].(map[string]any); ok {
			x, _ := mb["x"].(float64)
			y, _ := mb["y"].(float64)
			w, _ := mb["w"].(float64)
			h, _ := mb["h"].(float64)
			settings.ManagerBounds = &ManagerBounds{X: int(x), Y: int(y), W: int(w), H: int(h)}
		} else {
			settings.ManagerBounds = nil
		}
	}

	num := func(v any) int {
		if f, ok := v.(float64); ok {
			return int(f)
		}
		return 0
	}

	items := []Item{}
	for _, it := range raw["items"].([]any) {
		i, ok := it.(map[string]any)
		if !ok {
			continue
		}
		id := normStr(i["id"])
		if id == "" {
			id = newID()
		}
		items = append(items, Item{
			ID:         id,
			Name:       normStr(i["name"]),
			Key:        normStr(i["key"]),
			Value:      normStr(i["value"]),
			Note:       normStr(i["note"]),
			CategoryID: normStrPtr(i["categoryId"]),
			Tags:       normStrArr(i["tags"]),
			IsSecret:   normBool(i["isSecret"], true),
			Pinned:     normBool(i["pinned"], false),
			UseCount:   num(i["useCount"]),
			LastUsedAt: normStrPtr(i["lastUsedAt"]),
			CreatedAt:  orNow(normStr(i["createdAt"]), nowISO),
			UpdatedAt:  orNow(normStr(i["updatedAt"]), nowISO),
			DeletedAt:  normStrPtr(i["deletedAt"]),
		})
	}

	groups := []Group{}
	for _, g := range raw["groups"].([]any) {
		gr, ok := g.(map[string]any)
		if !ok {
			continue
		}
		id := normStr(gr["id"])
		if id == "" {
			id = newID()
		}
		// Mode (v1.5.0 §40): only the exact "document" value switches a
		// group to whole-document mode; everything else — missing, "" or a
		// hand-edited value — is a classic items group. The document text
		// itself passes through untouched (byte-exact, no trimming).
		mode := normStr(gr["mode"])
		if mode != GroupModeDocument {
			mode = ""
		}
		groups = append(groups, Group{
			ID:         id,
			Name:       normStr(gr["name"]),
			CategoryID: normStrPtr(gr["categoryId"]),
			Tags:       normStrArr(gr["tags"]),
			ItemIDs:    normStrArr(gr["itemIds"]),
			Mode:       mode,
			Document:   normStr(gr["document"]),
			IsSecret:   normBool(gr["isSecret"], false),
			Pinned:     normBool(gr["pinned"], false),
			UseCount:   num(gr["useCount"]),
			LastUsedAt: normStrPtr(gr["lastUsedAt"]),
			CreatedAt:  orNow(normStr(gr["createdAt"]), nowISO),
			UpdatedAt:  orNow(normStr(gr["updatedAt"]), nowISO),
			DeletedAt:  normStrPtr(gr["deletedAt"]),
		})
	}

	categories := []Category{}
	for _, c := range raw["categories"].([]any) {
		cat, ok := c.(map[string]any)
		if !ok {
			continue
		}
		id := normStr(cat["id"])
		if id == "" {
			id = newID()
		}
		categories = append(categories, Category{
			ID:        id,
			Name:      normStr(cat["name"]),
			SortOrder: num(cat["sortOrder"]),
			ParentID:  normStrPtr(cat["parentId"]),
		})
	}
	sanitizeCategoryTree(categories)

	return VaultData{
		SchemaVersion: int(sv),
		AppVersion:    orNow(normStr(raw["appVersion"]), appVersion),
		Encryption:    Encryption{Enabled: false},
		Settings:      settings,
		Categories:    categories,
		Items:         items,
		Groups:        groups,
	}, true
}

func orNow(s, fallback string) string {
	if s == "" {
		return fallback
	}
	return s
}

// sanitizeCategoryTree repairs broken nesting that could only come from a
// hand-edited or third-party file (v1.4.0, DECISIONS.md §41): dangling
// parent ids, self-parents, cycles, and chains deeper than MaxCategoryDepth
// all drop to the closest surviving ancestor (or top level). It runs in
// place on the slice loaded by NormalizeVault, before anything else sees it.
func sanitizeCategoryTree(cats []Category) {
	byID := make(map[string]int, len(cats))
	for i := range cats {
		byID[cats[i].ID] = i
	}
	// resolved reports whether cat's parent chain is sound, memoized via
	// a tri-state map so each node is walked at most once per outcome.
	const (
		unknown = 0
		broken  = 1
		sound   = 2
	)
	state := make(map[string]int, len(cats))
	var resolve func(i int, seen map[string]bool) int
	resolve = func(i int, seen map[string]bool) int {
		switch state[cats[i].ID] {
		case sound:
			return sound
		case broken:
			return broken
		}
		if seen[cats[i].ID] {
			return broken // cycle
		}
		seen[cats[i].ID] = true
		if cats[i].ParentID == nil {
			state[cats[i].ID] = sound
			return sound
		}
		p, ok := byID[*cats[i].ParentID]
		if !ok || p == i {
			state[cats[i].ID] = broken
			return broken
		}
		if resolve(p, seen) == broken {
			state[cats[i].ID] = broken
			return broken
		}
		state[cats[i].ID] = sound
		return sound
	}
	for i := range cats {
		if resolve(i, map[string]bool{}) == broken {
			cats[i].ParentID = nil
		}
	}
	// Depth pass: sound chains can still be deeper than the cap (e.g. a
	// long hand-written chain). Every over-deep category lifts one level
	// per pass (to its grandparent); repeat until stable — total depth
	// strictly decreases, so this terminates. Cycles/dangles are already
	// gone, so the upward walks are safe.
	for changed := true; changed; {
		changed = false
		for i := range cats {
			if cats[i].ParentID == nil {
				continue
			}
			d, cur := 1, i
			for cats[cur].ParentID != nil && d <= MaxCategoryDepth+1 {
				cur = byID[*cats[cur].ParentID]
				d++
			}
			if d > MaxCategoryDepth {
				// lift one level: parent := grandparent
				pid := *cats[i].ParentID
				cats[i].ParentID = cats[byID[pid]].ParentID
				changed = true
			}
		}
	}
}

// NewUUID is the ID generator (UUID v4).
func NewUUID() string { return uuid.NewString() }
