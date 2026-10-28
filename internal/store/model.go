/**
 * CLAVIS — data model (SPEC §4.2).
 *
 * JSON tags match the reference implementation byte-for-byte so the file on
 * disk stays compatible across editions. Item values are never logged.
 */
package store

import "time"

const (
	CurrentSchemaVersion = 1
	// TrashDays is how long soft-deleted entries stay in the trash.
	TrashDays = 30
	// DailyKeep is the number of newest daily backups kept.
	DailyKeep = 10
	// PreKeepDays is how long pre-migration/pre-import backups are kept.
	PreKeepDays = 30
	// MaxCategoryDepth caps how deep categories may nest (v1.4.0,
	// DECISIONS.md §41). 8 is far beyond any sane sidebar tree while
	// still bounding the ancestor walks that guard against cycles.
	MaxCategoryDepth = 8
)

// Encryption is the hook for a future master password (always off in v1).
type Encryption struct {
	Enabled bool `json:"enabled"`
}

// ManagerBounds remembers the Manager window geometry (DIP units).
type ManagerBounds struct {
	X int `json:"x"`
	Y int `json:"y"`
	W int `json:"w"`
	H int `json:"h"`
}

// Settings mirrors the settings block of the data file.
type Settings struct {
	Shortcut         string `json:"shortcut"`
	StartWithWindows bool   `json:"startWithWindows"`
	SolidMode        bool   `json:"solidMode"`
	// GlassIntensity is reserved and unused (the slider feature was
	// removed; UI-audit round 1 Phase 9, F-025). Kept so old data files
	// keep loading; NormalizeVault still clamps it defensively.
	GlassIntensity int            `json:"glassIntensity"`
	ShowLast4      bool           `json:"showLast4"`
	ManagerBounds  *ManagerBounds `json:"managerBounds"`
}

// Category is a user-created category. ParentID nests it under another
// category (nil = top level); nesting arrived in v1.4.0 (DECISIONS.md §41).
// The field is omitempty so flat vaults stay byte-identical to older files,
// and older Clavis versions simply ignore the unknown key (§4.2 lenient
// loading) — subcategories then appear as plain top-level categories.
type Category struct {
	ID        string  `json:"id"`
	Name      string  `json:"name"`
	SortOrder int     `json:"sortOrder"`
	ParentID  *string `json:"parentId,omitempty"`
}

// Item is a stored secret / prompt / note. Value never appears in logs.
type Item struct {
	ID         string   `json:"id"`
	Name       string   `json:"name"`
	Key        string   `json:"key"`
	Value      string   `json:"value"`
	Note       string   `json:"note"`
	CategoryID *string  `json:"categoryId"`
	Tags       []string `json:"tags"`
	IsSecret   bool     `json:"isSecret"`
	Pinned     bool     `json:"pinned"`
	UseCount   int      `json:"useCount"`
	LastUsedAt *string  `json:"lastUsedAt"`
	CreatedAt  string   `json:"createdAt"`
	UpdatedAt  string   `json:"updatedAt"`
	DeletedAt  *string  `json:"deletedAt"`
}

// Group stores references to items (shared items), in group order.
type Group struct {
	ID         string   `json:"id"`
	Name       string   `json:"name"`
	CategoryID *string  `json:"categoryId"`
	Tags       []string `json:"tags"`
	ItemIDs    []string `json:"itemIds"`
	Pinned     bool     `json:"pinned"`
	UseCount   int      `json:"useCount"`
	LastUsedAt *string  `json:"lastUsedAt"`
	CreatedAt  string   `json:"createdAt"`
	UpdatedAt  string   `json:"updatedAt"`
	DeletedAt  *string  `json:"deletedAt"`
}

// VaultData is the whole clavis-data.json document.
type VaultData struct {
	SchemaVersion int        `json:"schemaVersion"`
	AppVersion    string     `json:"appVersion"`
	Encryption    Encryption `json:"encryption"`
	Settings      Settings   `json:"settings"`
	Categories    []Category `json:"categories"`
	Items         []Item     `json:"items"`
	Groups        []Group    `json:"groups"`
}

// EntryKind discriminates items and groups.
type EntryKind string

const (
	KindItem  EntryKind = "item"
	KindGroup EntryKind = "group"
)

// BackupInfo describes one file inside backups/.
type BackupInfo struct {
	Name      string `json:"name"`
	TakenAt   string `json:"takenAt"`
	SizeBytes int64  `json:"sizeBytes"`
}

// State is the full snapshot served to the frontend.
type State struct {
	Data            VaultData    `json:"data"`
	Backups         []BackupInfo `json:"backups"`
	ReadOnly        bool         `json:"readOnly"`
	ReadOnlyReason  *string      `json:"readOnlyReason"`
	RecoveredNotice *string      `json:"recoveredNotice"`
	DataDir         string       `json:"dataDir"`
	AppVersion      string       `json:"appVersion"`
}

// DefaultSettings is the first-run settings block (§4.2).
func DefaultSettings() Settings {
	return Settings{
		Shortcut:         "Ctrl+Shift+Space",
		StartWithWindows: true,
		SolidMode:        false,
		GlassIntensity:   100,
		ShowLast4:        true,
		ManagerBounds:    nil,
	}
}

// NewerVersionMessage is the read-only guard message (§4.4).
const NewerVersionMessage = "This data was created by a newer version of Clavis. Please update the app."

// NowISO emits the same shape as the reference implementation's toISOString
// (UTC, millisecond precision, always "Z"). Lexicographic comparison of two
// NowISO strings is chronological.
func NowISO(t time.Time) string {
	return t.UTC().Format("2006-01-02T15:04:05.000Z")
}

// StarterVault builds the first-run content: three categories, no items (§4.3).
func StarterVault(appVersion string, newID func() string, now time.Time) VaultData {
	return VaultData{
		SchemaVersion: CurrentSchemaVersion,
		AppVersion:    appVersion,
		Encryption:    Encryption{Enabled: false},
		Settings:      DefaultSettings(),
		Categories: []Category{
			{ID: newID(), Name: "Credentials", SortOrder: 0},
			{ID: newID(), Name: "Prompts", SortOrder: 1},
			{ID: newID(), Name: "Notes", SortOrder: 2},
		},
		Items:  []Item{},
		Groups: []Group{},
	}
}
