/**
 * CLAVIS — the store engine (SPEC §4).
 *
 * One writer: every mutation runs through a mutex-serialized store; the
 * frontend never touches the file. Saves are atomic (tmp + fsync + rename)
 * and follow the spec'd backup policy:
 *   (a) once per day on the first change of that day;
 *   (b) always before any migration, import or backup-restore.
 * Retention: newest 10 daily backups + every pre-* backup from the last 30
 * days. Names: clavis-data-YYYYMMDD-HHMMSS.json (kind tracked in
 * backups/index.json).
 *
 * SECURITY: item values are never logged, never put in error messages.
 */
package store

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"clavis/internal/exchange"
)

// ErrReadOnly is returned when the app refuses to touch a newer data file.
var ErrReadOnly = errors.New(NewerVersionMessage)

// ErrNotFound is the generic missing-entry error (no values in messages).
type ErrNotFound struct{ What string }

func (e *ErrNotFound) Error() string { return e.What + " not found" }

func notFound(what, id string) error {
	// IDs are internal UUIDs; safe to surface, but keep messages value-free.
	return &ErrNotFound{What: fmt.Sprintf("%s %s", what, shortID(id))}
}

func shortID(id string) string {
	if len(id) > 8 {
		return id[:8] + "…"
	}
	return id
}

// badRequest is a validation failure the UI can show as-is (no ids, no values).
func badRequest(msg string) error { return errors.New(msg) }

// NewItem is the create-item input (§5.3 one short form).
type NewItem struct {
	Name       string
	Value      string
	Key        string
	Note       string
	CategoryID *string
	Tags       []string
	IsSecret   *bool // nil → derive from the category (§4.2)
	Pinned     bool
}

// ItemPatch is a partial item update; nil fields keep the current value.
type ItemPatch struct {
	Name       *string
	Key        *string
	Value      *string
	Note       *string
	CategoryID *string
	Tags       *[]string
	IsSecret   *bool
	Pinned     *bool
}

// NewGroup is the create-group input.
type NewGroup struct {
	Name       string
	CategoryID *string
	Tags       []string
	Pinned     bool
	ItemIDs    []string
	// IsSecret applies to document groups only (v1.5.0 §40): nil → true
	// (a pasted credentials document is a secret until the user says
	// otherwise — never under-mask).
	IsSecret *bool
}

// GroupPatch is a partial group update.
type GroupPatch struct {
	Name       *string
	CategoryID *string
	Tags       *[]string
	Pinned     *bool
	// IsSecret applies to document groups (the clipboard-privacy verdict
	// for whole-document copies; §40).
	IsSecret *bool
}

// SettingsPatch is the partial settings update (§5.9).
type SettingsPatch struct {
	Shortcut         *string
	StartWithWindows *bool
	SolidMode        *bool
	GlassIntensity   *int
	ShowLast4        *bool
	ManagerBounds    *ManagerBounds // non-nil replaces; nilWith set → clear
	ManagerBoundsSet bool
	ManagerBoundsNil bool
}

// CopyResult is the payload of the copy action (§5.2).
type CopyResult struct {
	Text           string `json:"text"`
	LineCount      int    `json:"lineCount"`
	ContainsSecret bool   `json:"containsSecret"`
}

// ImportSummary is the "Added 12, updated 3, skipped 2" report (§5.8A).
type ImportSummary struct {
	Added   int `json:"added"`
	Updated int `json:"updated"`
	Skipped int `json:"skipped"`
}

// ImportConflict names a duplicate (names only — never values).
type ImportConflict struct {
	FileIndex    int       `json:"fileIndex"`
	FileName     string    `json:"fileName"`
	Kind         EntryKind `json:"kind"`
	Name         string    `json:"name"`
	ExistingName string    `json:"existingName"`
	Reason       string    `json:"reason"` // "name" | "key"
}

// FilesPreview is the conflict report before applying a file import.
type FilesPreview struct {
	Conflicts   []ImportConflict `json:"conflicts"`
	ParsedCount int              `json:"parsedCount"`
}

// BackupPreview counts an incoming full backup (no values). Fragment is set
// (UI-audit round 1 Phase 4) when the file is a clavis-fragment — a partial
// export that merges; a full backup leaves it nil.
type BackupPreview struct {
	Valid    bool           `json:"valid"`
	Error    string         `json:"error,omitempty"`
	Items    int            `json:"items"`
	Groups   int            `json:"groups"`
	Cats     int            `json:"categories"`
	Fragment *FragmentScope `json:"fragment,omitempty"`
}

// ImportedFile is one file picked for import.
type ImportedFile struct {
	Name    string `json:"name"`
	Content string `json:"content"`
}

// PerFileResolution overrides the default conflict choice for one file.
type PerFileResolution struct {
	FileIndex int    `json:"fileIndex"`
	Choice    string `json:"choice"` // "reuse" | "keepBoth"
}

// ImportResolution is the dialog result (§5.8 duplicate handling).
type ImportResolution struct {
	Choice   string              `json:"choice"` // "reuse" | "keepBoth"
	ApplyAll bool                `json:"applyAll"`
	PerFile  []PerFileResolution `json:"perFile"`
}

type membership struct {
	GroupID string
	Index   int
}

type undoRecord struct {
	Kind        EntryKind
	Item        *Item
	Group       *Group
	Memberships []membership
}

type backupKind string

const (
	kindDaily        backupKind = "daily"
	kindPreMigration backupKind = "pre-migration"
	kindPreImport    backupKind = "pre-import"
	kindPreRestore   backupKind = "pre-restore"
)

// maxUndoRecords caps the undo ring: every soft delete keeps a full item
// snapshot (value included) in RAM, so the ring must not grow forever.
// The UI only ever offers undo for the most recent delete.
const maxUndoRecords = 50

// Store is the single-writer data store.
type Store struct {
	mu              sync.Mutex
	dir             string
	appVersion      string
	now             func() time.Time
	newID           func() string
	data            VaultData
	readOnly        bool
	readOnlyReason  *string
	recoveredNotice *string
	undoRing        map[string]undoRecord
	undoOrder       []string // FIFO of live undo tokens, oldest first

	/* v1.4.1 (DECISIONS.md §42): the exclusive data-folder lock — no two
	   Clavis processes (or two stores) may ever hold the same data
	   folder, so a stale copy can never rewrite an older snapshot over
	   the user's deletions. releaseLock is nil after Close. */
	releaseLock func()

	/* v1.4.1: deletion tombstones (see tombstones.go) — the log that
	   makes deletions stick even if something resurrects the file. */
	tombs map[string]string

	/* v1.4.1: per-write tmp sequence so two writers could never share a
	   tmp file (belt to the lock's suspenders). */
	tmpSeq uint64

	/* version is the snapshot generation counter: it bumps on every path
	   that can change what State() returns (persisted writes via
	   writeAtomicLocked, notice clears, reopens) and lets the service memoize
	   its serialized state map without going stale. Pure reads never bump
	   it. The backups listing is derived from the backups folder, which only
	   Clavis itself writes — always inside a save — so it tracks the same
	   generation. */
	version uint64
}

var backupNameRe = regexp.MustCompile(`^clavis-data-(\d{8})-(\d{6})\.json$`)

// Paths.
func (s *Store) dataFile() string    { return filepath.Join(s.dir, "clavis-data.json") }
func (s *Store) backupsDir() string  { return filepath.Join(s.dir, "backups") }
func (s *Store) backupIndex() string { return filepath.Join(s.dir, "backups", "index.json") }

// errDataFolderInUse is the friendly double-launch error (v1.4.1).
var errDataFolderInUse = errors.New("Clavis is already running — its data folder is in use. " +
	"Close the other Clavis (check the tray area near the clock) and try again.")

// New opens (or creates) the store in dir and returns it ready to use.
func New(dir, appVersion string) (*Store, error) {
	return NewWithClock(dir, appVersion, time.Now)
}

// NewWithClock is New with an injectable clock (tests).
func NewWithClock(dir, appVersion string, now func() time.Time) (*Store, error) {
	s := &Store{
		dir:        dir,
		appVersion: appVersion,
		now:        now,
		newID:      NewUUID,
		undoRing:   map[string]undoRecord{},
		tombs:      map[string]string{},
	}
	if err := os.MkdirAll(s.backupsDir(), 0o755); err != nil {
		return nil, fmt.Errorf("cannot create data folder: %w", err)
	}
	/* v1.4.1: exclusive lock FIRST — from here on, this is the only
	   store on this data folder, whatever else is (or stops) running. */
	release, err := acquireDirLock(filepath.Join(dir, "clavis.lock"))
	if err != nil {
		return nil, err
	}
	s.releaseLock = release
	s.sweepTmpFilesLocked()
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.initLocked(); err != nil {
		release()
		s.releaseLock = nil
		return nil, err
	}
	return s, nil
}

// Close releases the data-folder lock. Production code never calls it (the
// OS releases the lock when the process exits, crash included); tests use
// it to simulate a process ending before opening the folder again.
func (s *Store) Close() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.releaseLock != nil {
		s.releaseLock()
		s.releaseLock = nil
	}
}

// sweepTmpFilesLocked removes leftover atomic-write temp files. Safe only
// while the data-folder lock is held: any clavis-data.json.tmp-* that
// exists belongs to a dead writer.
func (s *Store) sweepTmpFilesLocked() {
	entries, err := os.ReadDir(s.dir)
	if err != nil {
		return
	}
	for _, e := range entries {
		n := e.Name()
		if strings.HasPrefix(n, "clavis-data.json.tmp") || strings.HasPrefix(n, "deletions.json.tmp") {
			_ = os.Remove(filepath.Join(s.dir, n))
		}
	}
}

// SetClock is used by tests to control time.
func (s *Store) SetClock(now func() time.Time) { s.now = now }

func (s *Store) initLocked() error {
	/* v1.4.1: the tombstone log is loaded before anything else so every
	   path below (fresh, parse, recovery, migration) can apply it. */
	s.tombs = s.loadTombsLocked()
	text, err := os.ReadFile(s.dataFile())
	if errors.Is(err, os.ErrNotExist) {
		s.data = StarterVault(s.appVersion, s.newID, s.now())
		return s.writeAtomicLocked()
	}
	if err != nil {
		return fmt.Errorf("cannot read data file: %w", err)
	}
	parsed, ok := s.parseVault(string(text))
	if !ok {
		if err := s.recoverFromBackupLocked(string(text)); err != nil {
			return err
		}
		return s.finishLoadLocked()
	}
	s.data = parsed
	if parsed.SchemaVersion > CurrentSchemaVersion {
		// Never touch a newer file. Run read-only.
		s.readOnly = true
		reason := NewerVersionMessage
		s.readOnlyReason = &reason
		return nil
	}
	if parsed.SchemaVersion < CurrentSchemaVersion {
		if err := s.backupLocked(kindPreMigration); err != nil {
			return err
		}
		s.data.SchemaVersion = CurrentSchemaVersion
		s.data.AppVersion = s.appVersion
		// (v1 is the only version today; migration steps would go here.)
		if err := s.writeAtomicLocked(); err != nil {
			return err
		}
	}
	return s.finishLoadLocked()
}

// finishLoadLocked is the shared tail of every load path (v1.4.1):
// re-apply deletion tombstones (anything a stale copy or an old backup
// resurrected goes back to the Trash, with a banner), then the usual
// 30-day trash purge. Caller holds s.mu.
func (s *Store) finishLoadLocked() error {
	if n := s.applyTombsLocked(); n > 0 {
		notice := tombstoneNotice(n)
		if s.recoveredNotice != nil {
			notice = *s.recoveredNotice + " " + notice
		}
		s.recoveredNotice = &notice
		if err := s.writeAtomicLocked(); err != nil {
			return err
		}
	}
	return s.purgeTrashLocked()
}

// parseVault mirrors the reference JSON.parse + normalizeVault pair.
func (s *Store) parseVault(text string) (VaultData, bool) {
	var parsed any
	if err := json.Unmarshal([]byte(text), &parsed); err != nil {
		return VaultData{}, false
	}
	return NormalizeVault(parsed, s.appVersion, NowISO(s.now()), s.newID)
}

// recoverFromBackupLocked restores the newest valid backup (§4.4).
func (s *Store) recoverFromBackupLocked(brokenText string) error {
	stamp := tsName(s.now())
	stamp = strings.TrimPrefix(stamp, "clavis-data-")
	brokenName := "clavis-data.broken-" + stamp
	_ = os.WriteFile(filepath.Join(s.dir, brokenName), []byte(brokenText), 0o644)

	backups := s.listBackups() // newest last → walk backwards
	for i := len(backups) - 1; i >= 0; i-- {
		b := backups[i]
		text, err := os.ReadFile(filepath.Join(s.backupsDir(), b.Name))
		if err != nil {
			continue
		}
		if parsed, ok := s.parseVault(string(text)); ok {
			s.data = parsed
			notice := "The data file was damaged, so Clavis restored your latest automatic backup. The damaged file was kept as " + brokenName + "."
			s.recoveredNotice = &notice
			return s.writeAtomicLocked()
		}
	}
	s.data = StarterVault(s.appVersion, s.newID, s.now())
	notice := "The data file was damaged and no valid backup was found, so Clavis started fresh. The damaged file was kept as " + brokenName + "."
	s.recoveredNotice = &notice
	return s.writeAtomicLocked()
}

// uniqueTmpPath builds a per-write temp path (v1.4.1): pid + sequence
// means no two writers — even two processes, if it ever came to that —
// can ever share a tmp file and interleave bytes into corruption.
func (s *Store) uniqueTmpPath(base string) string {
	return fmt.Sprintf("%s.tmp-%d-%d", base, os.Getpid(), atomic.AddUint64(&s.tmpSeq, 1))
}

// writeAtomicLocked writes tmp, fsyncs, then renames over the real file.
func (s *Store) writeAtomicLocked() error {
	s.version++ // the in-memory snapshot changes on every write path
	jsonBytes, err := marshalVault(s.data)
	if err != nil {
		return err
	}
	tmp := s.uniqueTmpPath(s.dataFile())
	fh, err := os.OpenFile(tmp, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o644)
	if err != nil {
		return fmt.Errorf("cannot open temp file: %w", err)
	}
	if _, err := fh.Write(jsonBytes); err != nil {
		fh.Close()
		os.Remove(tmp)
		return fmt.Errorf("cannot write temp file: %w", err)
	}
	if err := fh.Sync(); err != nil {
		fh.Close()
		os.Remove(tmp)
		return fmt.Errorf("cannot flush temp file: %w", err)
	}
	if err := fh.Close(); err != nil {
		os.Remove(tmp)
		return err
	}
	if err := os.Rename(tmp, s.dataFile()); err != nil {
		os.Remove(tmp)
		return fmt.Errorf("cannot replace data file: %w", err)
	}
	return nil
}

// marshalVault renders the file exactly like the reference: 2-space indent,
// no HTML escaping (values keep <, >, & verbatim).
func marshalVault(v VaultData) ([]byte, error) {
	var b strings.Builder
	enc := json.NewEncoder(&b)
	enc.SetEscapeHTML(false)
	enc.SetIndent("", "  ")
	if err := enc.Encode(v); err != nil {
		return nil, err
	}
	// json.Encoder appends a trailing newline; the reference JSON.stringify
	// does not. Trim it for byte-identical files.
	out := b.String()
	return []byte(strings.TrimSuffix(out, "\n")), nil
}

// ReadVaultBytes returns the current data as it would be written (backup export).
func (s *Store) ReadVaultBytes() ([]byte, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return marshalVault(s.data)
}

func tsName(t time.Time) string {
	return t.Format("clavis-data-20060102-150405.json")
}

func (s *Store) readBackupIndexLocked() map[string]string {
	out := map[string]string{}
	text, err := os.ReadFile(s.backupIndex())
	if err != nil {
		return out
	}
	var parsed map[string]string
	if json.Unmarshal(text, &parsed) == nil && parsed != nil {
		return parsed
	}
	return out
}

func (s *Store) writeBackupIndexLocked(index map[string]string) error {
	jsonBytes, err := json.MarshalIndent(index, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(s.backupIndex(), jsonBytes, 0o644)
}

// backupLocked copies the CURRENT on-disk data file into backups/ with the
// spec'd name. Must be called BEFORE modifying s.data. Same-second name
// collisions bump the timestamp by 1s.
func (s *Store) backupLocked(kind backupKind) error {
	index := s.readBackupIndexLocked()
	name := tsName(s.now())
	for index[name] != "" {
		m := backupNameRe.FindStringSubmatch(name)
		if m == nil {
			break
		}
		t, err := time.Parse("20060102-150405", m[1]+"-"+m[2])
		if err != nil {
			break
		}
		name = tsName(t.Add(1 * time.Second))
	}
	text, err := os.ReadFile(s.dataFile())
	if err != nil {
		return nil // nothing to back up yet (e.g. first write)
	}
	if err := os.WriteFile(filepath.Join(s.backupsDir(), name), text, 0o644); err != nil {
		return nil // backing up is best-effort
	}
	index[name] = string(kind)
	return s.applyRetentionLocked(index)
}

func (s *Store) applyRetentionLocked(index map[string]string) error {
	names := make([]string, 0, len(index))
	for n := range index {
		names = append(names, n)
	}
	sortStrings(names)

	keep := map[string]bool{}
	daily := []string{}
	pre := []string{}
	for _, n := range names {
		if index[n] == string(kindDaily) {
			daily = append(daily, n)
		} else {
			pre = append(pre, n)
		}
	}
	for _, n := range daily[max(0, len(daily)-DailyKeep):] {
		keep[n] = true
	}
	cutoff := s.now().AddDate(0, 0, -PreKeepDays)
	for _, n := range pre {
		m := backupNameRe.FindStringSubmatch(n)
		if m == nil {
			keep[n] = true // unknown name → never delete
			continue
		}
		t, err := time.Parse("20060102-150405", m[1]+"-"+m[2])
		if err == nil && !t.Before(cutoff) {
			keep[n] = true
		}
	}
	for _, n := range names {
		if !keep[n] {
			os.Remove(filepath.Join(s.backupsDir(), n))
			delete(index, n)
		}
	}
	return s.writeBackupIndexLocked(index)
}

func sortStrings(a []string) {
	for i := 1; i < len(a); i++ {
		for j := i; j > 0 && a[j] < a[j-1]; j-- {
			a[j], a[j-1] = a[j-1], a[j]
		}
	}
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}

// ListBackups returns the backup files, oldest first.
func (s *Store) ListBackups() []BackupInfo {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.listBackups()
}

func (s *Store) listBackups() []BackupInfo {
	entries, err := os.ReadDir(s.backupsDir())
	if err != nil {
		return []BackupInfo{}
	}
	names := []string{}
	for _, e := range entries {
		n := e.Name()
		if strings.HasPrefix(n, "clavis-data-") && strings.HasSuffix(n, ".json") {
			names = append(names, n)
		}
	}
	sortStrings(names)
	out := make([]BackupInfo, 0, len(names))
	for _, name := range names {
		takenAt := ""
		if m := backupNameRe.FindStringSubmatch(name); m != nil {
			if t, err := time.Parse("20060102-150405", m[1]+"-"+m[2]); err == nil {
				takenAt = NowISO(t)
			}
		}
		var size int64
		if st, err := os.Stat(filepath.Join(s.backupsDir(), name)); err == nil {
			size = st.Size()
		}
		out = append(out, BackupInfo{Name: name, TakenAt: takenAt, SizeBytes: size})
	}
	return out
}

// purgeTrashLocked removes entries deleted more than 30 days ago (§4.4).
func (s *Store) purgeTrashLocked() error {
	if s.readOnly {
		return nil
	}
	cutoff := s.now().AddDate(0, 0, -TrashDays)
	deadItems := map[string]bool{}
	deadGroups := map[string]bool{}
	for _, it := range s.data.Items {
		if it.DeletedAt != nil && parseISO(*it.DeletedAt).Before(cutoff) {
			deadItems[it.ID] = true
		}
	}
	for _, g := range s.data.Groups {
		if g.DeletedAt != nil && parseISO(*g.DeletedAt).Before(cutoff) {
			deadGroups[g.ID] = true
		}
	}
	if len(deadItems) == 0 && len(deadGroups) == 0 {
		return nil
	}
	items := s.data.Items[:0]
	for _, it := range s.data.Items {
		if !deadItems[it.ID] {
			items = append(items, it)
		}
	}
	s.data.Items = items
	groups := s.data.Groups[:0]
	for _, g := range s.data.Groups {
		if !deadGroups[g.ID] {
			groups = append(groups, g)
		}
	}
	s.data.Groups = groups
	for i := range s.data.Groups {
		g := &s.data.Groups[i]
		kept := g.ItemIDs[:0]
		for _, id := range g.ItemIDs {
			if !deadItems[id] {
				kept = append(kept, id)
			}
		}
		g.ItemIDs = kept
	}
	return s.writeAtomicLocked()
}

func parseISO(s string) time.Time {
	if t, err := time.Parse(time.RFC3339Nano, s); err == nil {
		return t
	}
	return time.Time{}
}

// saveLocked is the standard save path: daily backup on the first change of
// the day, then the atomic write.
func (s *Store) saveLocked(kind backupKind) error {
	if s.readOnly {
		return ErrReadOnly
	}
	if kind == kindDaily {
		index := s.readBackupIndexLocked()
		today := tsName(s.now())[:20] // "clavis-data-YYYYMMDD" (the day prefix)
		hasToday := false
		for n := range index {
			if strings.HasPrefix(n, today) {
				hasToday = true
				break
			}
		}
		if !hasToday {
			if err := s.backupLocked(kindDaily); err != nil {
				return err
			}
		}
	} else if err := s.backupLocked(kind); err != nil {
		return err
	}
	return s.writeAtomicLocked()
}

func (s *Store) assertWritable() error {
	if s.readOnly {
		if s.readOnlyReason != nil {
			return errors.New(*s.readOnlyReason)
		}
		return ErrReadOnly
	}
	return nil
}

// State returns the full snapshot for the frontend.
func (s *Store) State() State {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.stateLocked()
}

func (s *Store) stateLocked() State {
	return State{
		Data:            s.data,
		Backups:         s.listBackups(),
		ReadOnly:        s.readOnly,
		ReadOnlyReason:  s.readOnlyReason,
		RecoveredNotice: s.recoveredNotice,
		DataDir:         s.dir,
		AppVersion:      s.appVersion,
	}
}

// ItemValue returns the value of a live item. The UI state snapshot is
// redacted (values stripped); the edit form fetches exactly one value
// through this on demand.
func (s *Store) ItemValue(id string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	item := s.findItem(id)
	if item == nil || item.DeletedAt != nil {
		return "", notFound("Item", id)
	}
	return item.Value, nil
}

// GroupDocument returns the verbatim document of a live document group.
// The UI state snapshot is redacted (documents stripped, like item values);
// the group editor fetches the document on demand for the copy fallback and
// the re-paste editor.
func (s *Store) GroupDocument(id string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	group := s.findGroup(id)
	if group == nil || group.DeletedAt != nil {
		return "", notFound("Group", id)
	}
	if !group.IsDocumentGroup() {
		return "", errors.New("this group stores items, not a document")
	}
	return group.Document, nil
}

// ReadOnly reports the read-only guard state.
func (s *Store) ReadOnly() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.readOnly
}

// DataDir is the folder that holds clavis-data.json.
func (s *Store) DataDir() string { return s.dir }

func ptr[T any](v T) *T { return &v }

func trimPtr(s string) *string { t := strings.TrimSpace(s); return &t }

// CreateItem adds an item (§5.3). isSecret defaults per category (§4.2).
func (s *Store) CreateItem(input NewItem) (Item, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.assertWritable(); err != nil {
		return Item{}, err
	}
	var categoryID *string
	if input.CategoryID != nil && *input.CategoryID != "" {
		categoryID = input.CategoryID
	} else {
		categoryID = nil
	}
	isSecret := false
	if input.IsSecret != nil {
		isSecret = *input.IsSecret
	} else if categoryID != nil {
		for _, c := range s.data.Categories {
			if c.ID == *categoryID && c.Name == "Credentials" {
				isSecret = true
				break
			}
		}
	}
	now := NowISO(s.now())
	item := Item{
		ID:         s.newID(),
		Name:       strings.TrimSpace(input.Name),
		Key:        strings.TrimSpace(input.Key),
		Value:      input.Value,
		Note:       input.Note,
		CategoryID: categoryID,
		Tags:       cleanTags(input.Tags),
		IsSecret:   isSecret,
		Pinned:     input.Pinned,
		UseCount:   0,
		LastUsedAt: nil,
		CreatedAt:  now,
		UpdatedAt:  now,
		DeletedAt:  nil,
	}
	s.data.Items = append(s.data.Items, item)
	return item, s.saveLocked(kindDaily)
}

// CreateItemInGroup creates an item AND appends it to a live group in ONE
// atomic save (v1.5.0, DECISIONS.md §40 — the quick "Name + Value + Add"
// form inside an open group). This is the only sanctioned add-an-item-to-a-
// group path from the group view: it can never create a group as a side
// effect, and there is no window where the item exists but is not yet a
// member. Item semantics mirror CreateItem (name required, isSecret derives
// from the group's category when not forced).
func (s *Store) CreateItemInGroup(groupID string, input NewItem) (Item, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.assertWritable(); err != nil {
		return Item{}, err
	}
	group := s.findGroup(groupID)
	if group == nil || group.DeletedAt != nil {
		return Item{}, notFound("Group", groupID)
	}
	if group.IsDocumentGroup() {
		return Item{}, errors.New("this group stores a whole document and takes no items")
	}
	name := strings.TrimSpace(input.Name)
	if name == "" {
		return Item{}, errors.New("give the item a name first")
	}
	var categoryID *string
	if input.CategoryID != nil && *input.CategoryID != "" {
		categoryID = input.CategoryID
	} else {
		// Default to the group's own category so a quick-added
		// credential lands where the group lives.
		categoryID = group.CategoryID
	}
	isSecret := false
	if input.IsSecret != nil {
		isSecret = *input.IsSecret
	} else if categoryID != nil {
		for _, c := range s.data.Categories {
			if c.ID == *categoryID && c.Name == "Credentials" {
				isSecret = true
				break
			}
		}
	}
	now := NowISO(s.now())
	item := Item{
		ID:         s.newID(),
		Name:       name,
		Key:        strings.TrimSpace(input.Key),
		Value:      input.Value,
		Note:       input.Note,
		CategoryID: categoryID,
		Tags:       cleanTags(input.Tags),
		IsSecret:   isSecret,
		Pinned:     input.Pinned,
		UseCount:   0,
		LastUsedAt: nil,
		CreatedAt:  now,
		UpdatedAt:  now,
		DeletedAt:  nil,
	}
	s.data.Items = append(s.data.Items, item)
	group.ItemIDs = append(group.ItemIDs, item.ID)
	group.UpdatedAt = now
	return item, s.saveLocked(kindDaily)
}

func cleanTags(tags []string) []string {
	out := []string{}
	for _, t := range tags {
		t = strings.TrimSpace(t)
		if t != "" {
			out = append(out, t)
		}
	}
	return out
}

func (s *Store) findItem(id string) *Item {
	for i := range s.data.Items {
		if s.data.Items[i].ID == id {
			return &s.data.Items[i]
		}
	}
	return nil
}

func (s *Store) findGroup(id string) *Group {
	for i := range s.data.Groups {
		if s.data.Groups[i].ID == id {
			return &s.data.Groups[i]
		}
	}
	return nil
}

func applyItemPatch(item *Item, patch ItemPatch) {
	if patch.Name != nil {
		item.Name = strings.TrimSpace(*patch.Name)
	}
	if patch.Key != nil {
		item.Key = strings.TrimSpace(*patch.Key)
	}
	if patch.Value != nil {
		item.Value = *patch.Value
	}
	if patch.Note != nil {
		item.Note = *patch.Note
	}
	if patch.CategoryID != nil {
		if *patch.CategoryID == "" {
			item.CategoryID = nil
		} else {
			item.CategoryID = patch.CategoryID
		}
	}
	if patch.Tags != nil {
		item.Tags = cleanTags(*patch.Tags)
	}
	if patch.IsSecret != nil {
		item.IsSecret = *patch.IsSecret
	}
	if patch.Pinned != nil {
		item.Pinned = *patch.Pinned
	}
}

// UpdateItem edits an item in place.
func (s *Store) UpdateItem(id string, patch ItemPatch) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.assertWritable(); err != nil {
		return err
	}
	item := s.findItem(id)
	if item == nil {
		return notFound("Item", id)
	}
	applyItemPatch(item, patch)
	item.UpdatedAt = NowISO(s.now())
	return s.saveLocked(kindDaily)
}

// SplitItemForGroup implements §5.6 "Only for this group": a new copy
// replaces the reference in that group only.
func (s *Store) SplitItemForGroup(id, groupID string, patch ItemPatch) (Item, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.assertWritable(); err != nil {
		return Item{}, err
	}
	item := s.findItem(id)
	group := s.findGroup(groupID)
	if item == nil {
		return Item{}, notFound("Item", id)
	}
	if group == nil {
		return Item{}, notFound("Group", groupID)
	}
	copyItem := *item
	applyItemPatch(&copyItem, patch)
	if patch.Name != nil {
		copyItem.Name = strings.TrimSpace(*patch.Name)
	}
	copyItem.ID = s.newID()
	copyItem.UseCount = 0
	copyItem.LastUsedAt = nil
	now := NowISO(s.now())
	copyItem.CreatedAt = now
	copyItem.UpdatedAt = now
	copyItem.DeletedAt = nil
	s.data.Items = append(s.data.Items, copyItem)
	for i, x := range group.ItemIDs {
		if x == id {
			group.ItemIDs[i] = copyItem.ID
		}
	}
	group.UpdatedAt = now
	return copyItem, s.saveLocked(kindDaily)
}

// DuplicateItem copies an item ("name (copy)").
func (s *Store) DuplicateItem(id string) (Item, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.assertWritable(); err != nil {
		return Item{}, err
	}
	item := s.findItem(id)
	if item == nil {
		return Item{}, notFound("Item", id)
	}
	copyItem := *item
	copyItem.ID = s.newID()
	copyItem.Name = item.Name + " (copy)"
	copyItem.UseCount = 0
	copyItem.LastUsedAt = nil
	now := NowISO(s.now())
	copyItem.CreatedAt = now
	copyItem.UpdatedAt = now
	copyItem.DeletedAt = nil
	s.data.Items = append(s.data.Items, copyItem)
	return copyItem, s.saveLocked(kindDaily)
}

// CreateGroupFromEnv creates a group AND its member items in one shot from
// pasted KEY=value lines (the "credentials for a whole project" flow). Each
// line becomes an item (name = key, key = key, IsSecret = true — never
// under-mask; the user can relax it per item). Keys are deduped (KEY_2, …)
// so the group block round-trips (§10).
func (s *Store) CreateGroupFromEnv(input NewGroup, text string) (Group, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.assertWritable(); err != nil {
		return Group{}, err
	}
	name := strings.TrimSpace(input.Name)
	if name == "" {
		return Group{}, errors.New("give the group a name first")
	}
	type line struct{ key, value string }
	var lines []line
	for _, raw := range strings.Split(text, "\n") {
		l := strings.TrimSuffix(raw, "\r") // tolerate CRLF pastes
		if strings.TrimSpace(l) == "" {
			continue
		}
		if k, v, ok := exchange.ParseDotenvLine(l); ok {
			lines = append(lines, line{key: k, value: v})
		}
	}
	if len(lines) == 0 {
		return Group{}, errors.New("no KEY=value lines found; paste one credential per line, like DATABASE_URL=postgres://…")
	}
	keys := exchange.DedupeKeys(func() []string {
		ks := make([]string, len(lines))
		for i, l := range lines {
			ks[i] = l.key
		}
		return ks
	}())
	var categoryID *string
	if input.CategoryID != nil && *input.CategoryID != "" {
		categoryID = input.CategoryID
	}
	now := NowISO(s.now())
	itemIDs := make([]string, 0, len(lines))
	for i, l := range lines {
		item := Item{
			ID:         s.newID(),
			Name:       keys[i],
			Key:        keys[i],
			Value:      l.value,
			Note:       "",
			CategoryID: categoryID,
			Tags:       []string{},
			IsSecret:   true,
			Pinned:     false,
			UseCount:   0,
			LastUsedAt: nil,
			CreatedAt:  now,
			UpdatedAt:  now,
			DeletedAt:  nil,
		}
		s.data.Items = append(s.data.Items, item)
		itemIDs = append(itemIDs, item.ID)
	}
	group := Group{
		ID:         s.newID(),
		Name:       name,
		CategoryID: categoryID,
		Tags:       cleanTags(input.Tags),
		ItemIDs:    itemIDs,
		Pinned:     input.Pinned,
		UseCount:   0,
		LastUsedAt: nil,
		CreatedAt:  now,
		UpdatedAt:  now,
		DeletedAt:  nil,
	}
	s.data.Groups = append(s.data.Groups, group)
	return group, s.saveLocked(kindDaily)
}

// CreateGroupFromDoc creates a whole-document group (v1.5.0, DECISIONS.md
// §40): the user pasted one entire markdown/text file during creation and
// the group stores it VERBATIM — byte-exact, every whitespace character,
// line break and blank line preserved; nothing is trimmed, parsed or
// re-formatted. Copy on such a group hands back exactly these bytes.
func (s *Store) CreateGroupFromDoc(input NewGroup, document string) (Group, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.assertWritable(); err != nil {
		return Group{}, err
	}
	name := strings.TrimSpace(input.Name)
	if name == "" {
		return Group{}, errors.New("give the group a name first")
	}
	var categoryID *string
	if input.CategoryID != nil && *input.CategoryID != "" {
		categoryID = input.CategoryID
	}
	isSecret := true // never under-mask: a pasted credentials doc is secret by default
	if input.IsSecret != nil {
		isSecret = *input.IsSecret
	}
	now := NowISO(s.now())
	group := Group{
		ID:         s.newID(),
		Name:       name,
		CategoryID: categoryID,
		Tags:       cleanTags(input.Tags),
		ItemIDs:    []string{},
		Mode:       GroupModeDocument,
		Document:   document,
		IsSecret:   isSecret,
		Pinned:     input.Pinned,
		UseCount:   0,
		LastUsedAt: nil,
		CreatedAt:  now,
		UpdatedAt:  now,
		DeletedAt:  nil,
	}
	s.data.Groups = append(s.data.Groups, group)
	return group, s.saveLocked(kindDaily)
}

// SetGroupDocument replaces the stored document of a live document group.
// The replacement is verbatim (byte-exact) — this is the "edit / re-paste
// the content later" path (§40).
func (s *Store) SetGroupDocument(id string, document string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.assertWritable(); err != nil {
		return err
	}
	group := s.findGroup(id)
	if group == nil || group.DeletedAt != nil {
		return notFound("Group", id)
	}
	if !group.IsDocumentGroup() {
		return errors.New("this group stores items, not a document")
	}
	group.Document = document
	group.UpdatedAt = NowISO(s.now())
	return s.saveLocked(kindDaily)
}

// CreateGroup adds a group; itemIds are filtered to live items.
func (s *Store) CreateGroup(input NewGroup) (Group, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.assertWritable(); err != nil {
		return Group{}, err
	}
	var categoryID *string
	if input.CategoryID != nil && *input.CategoryID != "" {
		categoryID = input.CategoryID
	}
	itemIDs := []string{}
	for _, id := range input.ItemIDs {
		if it := s.findItem(id); it != nil && it.DeletedAt == nil {
			itemIDs = append(itemIDs, id)
		}
	}
	now := NowISO(s.now())
	group := Group{
		ID:         s.newID(),
		Name:       strings.TrimSpace(input.Name),
		CategoryID: categoryID,
		Tags:       cleanTags(input.Tags),
		ItemIDs:    itemIDs,
		Pinned:     input.Pinned,
		UseCount:   0,
		LastUsedAt: nil,
		CreatedAt:  now,
		UpdatedAt:  now,
		DeletedAt:  nil,
	}
	s.data.Groups = append(s.data.Groups, group)
	return group, s.saveLocked(kindDaily)
}

// UpdateGroup edits a group's metadata.
func (s *Store) UpdateGroup(id string, patch GroupPatch) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.assertWritable(); err != nil {
		return err
	}
	group := s.findGroup(id)
	if group == nil {
		return notFound("Group", id)
	}
	if patch.Name != nil {
		group.Name = strings.TrimSpace(*patch.Name)
	}
	if patch.CategoryID != nil {
		if *patch.CategoryID == "" {
			group.CategoryID = nil
		} else {
			group.CategoryID = patch.CategoryID
		}
	}
	if patch.Tags != nil {
		group.Tags = cleanTags(*patch.Tags)
	}
	if patch.Pinned != nil {
		group.Pinned = *patch.Pinned
	}
	if patch.IsSecret != nil && group.IsDocumentGroup() {
		group.IsSecret = *patch.IsSecret
	}
	group.UpdatedAt = NowISO(s.now())
	return s.saveLocked(kindDaily)
}

// AddItemsToGroup appends members that are not already present.
func (s *Store) AddItemsToGroup(groupID string, itemIDs []string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.assertWritable(); err != nil {
		return err
	}
	group := s.findGroup(groupID)
	if group == nil {
		return notFound("Group", groupID)
	}
	for _, id := range itemIDs {
		if it := s.findItem(id); it != nil && it.DeletedAt == nil && !containsStr(group.ItemIDs, id) {
			group.ItemIDs = append(group.ItemIDs, id)
		}
	}
	group.UpdatedAt = NowISO(s.now())
	return s.saveLocked(kindDaily)
}

func containsStr(a []string, x string) bool {
	for _, v := range a {
		if v == x {
			return true
		}
	}
	return false
}

// RemoveItemFromGroup removes the reference only (never the item).
func (s *Store) RemoveItemFromGroup(groupID, itemID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.assertWritable(); err != nil {
		return err
	}
	group := s.findGroup(groupID)
	if group == nil {
		return notFound("Group", groupID)
	}
	kept := group.ItemIDs[:0]
	for _, id := range group.ItemIDs {
		if id != itemID {
			kept = append(kept, id)
		}
	}
	group.ItemIDs = kept
	group.UpdatedAt = NowISO(s.now())
	return s.saveLocked(kindDaily)
}

// ReorderGroupItems sets the member order; unknown ids keep their position
// at the end.
func (s *Store) ReorderGroupItems(groupID string, itemIDs []string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.assertWritable(); err != nil {
		return err
	}
	group := s.findGroup(groupID)
	if group == nil {
		return notFound("Group", groupID)
	}
	current := map[string]bool{}
	for _, id := range group.ItemIDs {
		current[id] = true
	}
	next := []string{}
	for _, id := range itemIDs {
		if current[id] && !containsStr(next, id) {
			next = append(next, id)
		}
	}
	for _, id := range group.ItemIDs {
		if !containsStr(next, id) {
			next = append(next, id)
		}
	}
	group.ItemIDs = next
	group.UpdatedAt = NowISO(s.now())
	return s.saveLocked(kindDaily)
}

// DeleteEntry soft-deletes and returns an undo token (§5.7). Deleting a
// group never deletes its items.
func (s *Store) DeleteEntry(kind EntryKind, id string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.assertWritable(); err != nil {
		return "", err
	}
	token := s.newID()
	now := NowISO(s.now())
	if kind == KindItem {
		item := s.findItem(id)
		if item == nil {
			return "", notFound("Item", id)
		}
		snapshot := *item
		snapshot.Tags = append([]string{}, item.Tags...)
		var memberships []membership
		for _, g := range s.data.Groups {
			if g.DeletedAt != nil {
				continue
			}
			for idx, x := range g.ItemIDs {
				if x == id {
					memberships = append(memberships, membership{GroupID: g.ID, Index: idx})
					break
				}
			}
		}
		s.undoRing[token] = undoRecord{Kind: kind, Item: &snapshot, Memberships: memberships}
		item.DeletedAt = &now
		item.UpdatedAt = now
		s.trackUndo(token)
	} else {
		group := s.findGroup(id)
		if group == nil {
			return "", notFound("Group", id)
		}
		snapshot := *group
		snapshot.Tags = append([]string{}, group.Tags...)
		snapshot.ItemIDs = append([]string{}, group.ItemIDs...)
		s.undoRing[token] = undoRecord{Kind: kind, Group: &snapshot}
		group.DeletedAt = &now
		group.UpdatedAt = now
		s.trackUndo(token)
	}
	if err := s.saveLocked(kindDaily); err != nil {
		return "", err
	}
	/* v1.4.1 (DECISIONS.md §42): remember the deletion so nothing can
	   resurrect this entry silently (see tombstones.go). */
	s.addTombLocked(id, now)
	return token, nil
}

// trackUndo appends a token to the FIFO and evicts the oldest records
// beyond the cap (no-op for already-undone tokens).
func (s *Store) trackUndo(token string) {
	s.undoOrder = append(s.undoOrder, token)
	if len(s.undoOrder) <= maxUndoRecords {
		return
	}
	drop := s.undoOrder[0]
	s.undoOrder = append(s.undoOrder[:0], s.undoOrder[1:]...)
	delete(s.undoRing, drop)
}

// forgetUndo removes a consumed token from the FIFO.
func (s *Store) forgetUndo(token string) {
	for i, t := range s.undoOrder {
		if t == token {
			s.undoOrder = append(s.undoOrder[:i], s.undoOrder[i+1:]...)
			return
		}
	}
}

// UndoDelete restores the entry exactly, including group memberships.
func (s *Store) UndoDelete(token string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.assertWritable(); err != nil {
		return err
	}
	rec, ok := s.undoRing[token]
	if !ok {
		return errors.New("Nothing to undo")
	}
	delete(s.undoRing, token)
	s.forgetUndo(token)
	if rec.Kind == KindItem {
		saved := *rec.Item
		saved.DeletedAt = nil
		if existing := s.findItem(saved.ID); existing != nil {
			*existing = saved
		} else {
			s.data.Items = append(s.data.Items, saved)
		}
		for _, m := range rec.Memberships {
			if g := s.findGroup(m.GroupID); g != nil && g.DeletedAt == nil && !containsStr(g.ItemIDs, saved.ID) {
				at := m.Index
				if at > len(g.ItemIDs) {
					at = len(g.ItemIDs)
				}
				g.ItemIDs = append(g.ItemIDs[:at], append([]string{saved.ID}, g.ItemIDs[at:]...)...)
			}
		}
	} else {
		saved := *rec.Group
		saved.DeletedAt = nil
		if existing := s.findGroup(saved.ID); existing != nil {
			*existing = saved
		} else {
			s.data.Groups = append(s.data.Groups, saved)
		}
	}
	if err := s.saveLocked(kindDaily); err != nil {
		return err
	}
	/* v1.4.1: undo is an intentional un-delete — forget the tombstone. */
	if rec.Kind == KindItem {
		s.removeTombLocked(rec.Item.ID)
	} else {
		s.removeTombLocked(rec.Group.ID)
	}
	return nil
}

// RestoreEntry takes an entry out of the trash.
func (s *Store) RestoreEntry(kind EntryKind, id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.assertWritable(); err != nil {
		return err
	}
	if kind == KindItem {
		item := s.findItem(id)
		if item == nil {
			return notFound("Item", id)
		}
		item.DeletedAt = nil
		item.UpdatedAt = NowISO(s.now())
	} else {
		group := s.findGroup(id)
		if group == nil {
			return notFound("Group", id)
		}
		group.DeletedAt = nil
		group.UpdatedAt = NowISO(s.now())
	}
	if err := s.saveLocked(kindDaily); err != nil {
		return err
	}
	/* v1.4.1: restoring from the Trash is an intentional un-delete —
	   forget the tombstone. */
	s.removeTombLocked(id)
	return nil
}

// PurgeEntry removes an entry forever.
func (s *Store) PurgeEntry(kind EntryKind, id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.assertWritable(); err != nil {
		return err
	}
	if kind == KindItem {
		items := s.data.Items[:0]
		for _, it := range s.data.Items {
			if it.ID != id {
				items = append(items, it)
			}
		}
		s.data.Items = items
		for i := range s.data.Groups {
			g := &s.data.Groups[i]
			kept := g.ItemIDs[:0]
			for _, x := range g.ItemIDs {
				if x != id {
					kept = append(kept, x)
				}
			}
			g.ItemIDs = kept
		}
	} else {
		groups := s.data.Groups[:0]
		for _, g := range s.data.Groups {
			if g.ID != id {
				groups = append(groups, g)
			}
		}
		s.data.Groups = groups
	}
	return s.saveLocked(kindDaily)
}

// EmptyTrash purges everything that is soft-deleted.
func (s *Store) EmptyTrash() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.assertWritable(); err != nil {
		return err
	}
	deadItems := map[string]bool{}
	for _, it := range s.data.Items {
		if it.DeletedAt != nil {
			deadItems[it.ID] = true
		}
	}
	items := s.data.Items[:0]
	for _, it := range s.data.Items {
		if it.DeletedAt == nil {
			items = append(items, it)
		}
	}
	s.data.Items = items
	groups := s.data.Groups[:0]
	for _, g := range s.data.Groups {
		if g.DeletedAt == nil {
			groups = append(groups, g)
		}
	}
	s.data.Groups = groups
	for i := range s.data.Groups {
		g := &s.data.Groups[i]
		kept := g.ItemIDs[:0]
		for _, id := range g.ItemIDs {
			if !deadItems[id] {
				kept = append(kept, id)
			}
		}
		g.ItemIDs = kept
	}
	return s.saveLocked(kindDaily)
}

// CreateCategory adds a category at the end, optionally nested under
// parentID (v1.4.0, DECISIONS.md §41). parentID nil/"" = top level.
func (s *Store) CreateCategory(name string, parentID *string) (Category, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.assertWritable(); err != nil {
		return Category{}, err
	}
	parent, err := s.resolveParentLocked(parentID)
	if err != nil {
		return Category{}, err
	}
	if parent != nil && s.categoryDepthLocked(*parent)+1 > MaxCategoryDepth {
		return Category{}, badRequest("categories cannot nest more than " + strconv.Itoa(MaxCategoryDepth) + " levels deep")
	}
	sortOrder := -1
	for _, c := range s.data.Categories {
		if c.SortOrder > sortOrder {
			sortOrder = c.SortOrder
		}
	}
	cat := Category{ID: s.newID(), Name: strings.TrimSpace(name), SortOrder: sortOrder + 1, ParentID: parent}
	s.data.Categories = append(s.data.Categories, cat)
	return cat, s.saveLocked(kindDaily)
}

// SetCategoryParent re-parents a category (move it under another category or
// back to the top level). It refuses self-parenting, unknown ids, parents
// inside the moved subtree (would create a cycle), and results deeper than
// MaxCategoryDepth.
func (s *Store) SetCategoryParent(id string, parentID *string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.assertWritable(); err != nil {
		return err
	}
	idx := -1
	for i := range s.data.Categories {
		if s.data.Categories[i].ID == id {
			idx = i
			break
		}
	}
	if idx < 0 {
		return notFound("Category", id)
	}
	parent, err := s.resolveParentLocked(parentID)
	if err != nil {
		return err
	}
	if parent != nil {
		if *parent == id {
			return badRequest("a category cannot be its own parent")
		}
		// The new parent must not live inside the moved subtree.
		cur := parent
		for cur != nil {
			if *cur == id {
				return badRequest("cannot move a category under one of its own subcategories")
			}
			cur = s.data.categoryByID(*cur).ParentID
		}
		// Deepest resulting node: the moved node sits at depth(parent)+1,
		// its subtree adds height(id)-1 more — i.e. depth(parent)+height(id).
		if s.categoryDepthLocked(*parent)+s.categoryHeightLocked(id) > MaxCategoryDepth {
			return badRequest("categories cannot nest more than " + strconv.Itoa(MaxCategoryDepth) + " levels deep")
		}
	}
	s.data.Categories[idx].ParentID = parent
	return s.saveLocked(kindDaily)
}

// resolveParentLocked validates a parent reference (nil/"" → nil = top
// level; otherwise the id must exist). It returns a COPY of the id — the
// store never retains the caller's pointer, which may be a scratch variable
// the caller reuses after the call (aliasing it would corrupt the tree).
// Caller holds s.mu.
func (s *Store) resolveParentLocked(parentID *string) (*string, error) {
	if parentID == nil || *parentID == "" {
		return nil, nil
	}
	id := *parentID
	if s.data.categoryByID(id) == nil {
		return nil, notFound("Category", id)
	}
	return &id, nil
}

// categoryByID returns the category or nil. Caller holds s.mu.
func (d *VaultData) categoryByID(id string) *Category {
	for i := range d.Categories {
		if d.Categories[i].ID == id {
			return &d.Categories[i]
		}
	}
	return nil
}

// categoryDepthLocked returns the category's depth (top level = 1). Caller
// holds s.mu. Parent chains are acyclic by construction (validated on every
// write; NormalizeVault repairs foreign files).
func (s *Store) categoryDepthLocked(id string) int {
	d := 1
	for c := s.data.categoryByID(id); c != nil && c.ParentID != nil; c = s.data.categoryByID(*c.ParentID) {
		d++
	}
	return d
}

// categoryHeightLocked returns the height of the subtree rooted at id
// (single node = 1). Caller holds s.mu.
func (s *Store) categoryHeightLocked(id string) int {
	h := 1
	for _, c := range s.data.Categories {
		if c.ParentID != nil && *c.ParentID == id {
			sub := s.categoryHeightLocked(c.ID)
			if sub+1 > h {
				h = sub + 1
			}
		}
	}
	return h
}

// RenameCategory renames a category.
func (s *Store) RenameCategory(id, name string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.assertWritable(); err != nil {
		return err
	}
	for i := range s.data.Categories {
		if s.data.Categories[i].ID == id {
			s.data.Categories[i].Name = strings.TrimSpace(name)
			return s.saveLocked(kindDaily)
		}
	}
	return notFound("Category", id)
}

// DeleteCategory keeps its items (they become uncategorized) and lifts its
// subcategories one level up — to the deleted category's own parent, or the
// top level. No subcategory is ever deleted by side effect.
func (s *Store) DeleteCategory(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.assertWritable(); err != nil {
		return err
	}
	victim := s.data.categoryByID(id)
	if victim == nil {
		return notFound("Category", id)
	}
	orphan := victim.ParentID // where the children go
	cats := s.data.Categories[:0]
	for _, c := range s.data.Categories {
		if c.ID == id {
			continue
		}
		if c.ParentID != nil && *c.ParentID == id {
			c.ParentID = orphan
		}
		cats = append(cats, c)
	}
	s.data.Categories = cats
	for i := range s.data.Items {
		if s.data.Items[i].CategoryID != nil && *s.data.Items[i].CategoryID == id {
			s.data.Items[i].CategoryID = nil
		}
	}
	for i := range s.data.Groups {
		if s.data.Groups[i].CategoryID != nil && *s.data.Groups[i].CategoryID == id {
			s.data.Groups[i].CategoryID = nil
		}
	}
	return s.saveLocked(kindDaily)
}

// UpdateSettings applies a partial settings patch (§5.9).
func (s *Store) UpdateSettings(patch SettingsPatch) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.assertWritable(); err != nil {
		return err
	}
	st := &s.data.Settings
	if patch.Shortcut != nil && strings.TrimSpace(*patch.Shortcut) != "" {
		st.Shortcut = strings.TrimSpace(*patch.Shortcut)
	}
	if patch.StartWithWindows != nil {
		st.StartWithWindows = *patch.StartWithWindows
	}
	if patch.SolidMode != nil {
		st.SolidMode = *patch.SolidMode
	}
	if patch.GlassIntensity != nil {
		g := *patch.GlassIntensity
		if g < 0 {
			g = 0
		}
		if g > 100 {
			g = 100
		}
		st.GlassIntensity = g
	}
	if patch.ShowLast4 != nil {
		st.ShowLast4 = *patch.ShowLast4
	}
	if patch.ManagerBoundsSet {
		st.ManagerBounds = patch.ManagerBounds
	}
	return s.saveLocked(kindDaily)
}

// Member is a group member with its resolved dotenv key.
type Member struct {
	Item Item
	Key  string
}

// GroupMembers resolves a group's live members and their dotenv keys
// (§4.2 auto-key + dedupe).
func (s *Store) GroupMembers(groupID string) ([]Member, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.groupMembersLocked(groupID)
}

func (s *Store) groupMembersLocked(groupID string) ([]Member, error) {
	group := s.findGroup(groupID)
	if group == nil {
		return nil, notFound("Group", groupID)
	}
	live := []*Item{}
	for _, id := range group.ItemIDs {
		if it := s.findItem(id); it != nil && it.DeletedAt == nil {
			live = append(live, it)
		}
	}
	rawKeys := make([]string, len(live))
	for i, it := range live {
		if strings.TrimSpace(it.Key) != "" {
			rawKeys[i] = it.Key
		} else {
			rawKeys[i] = exchange.AutoKey(it.Name)
		}
	}
	keys := exchange.DedupeKeys(rawKeys)
	out := make([]Member, len(live))
	for i, it := range live {
		out[i] = Member{Item: *it, Key: keys[i]}
	}
	return out, nil
}

// Copy prepares the §5.2 clipboard payload — item value exactly; group as
// KEY=value lines. It does NOT record use: the counter moves only after the
// caller's clipboard write succeeded (MarkUsed) — counting intent alone
// inflated the "most used" ranking for copies that never landed.
func (s *Store) Copy(kind EntryKind, id string) (CopyResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if kind == KindItem {
		item := s.findItem(id)
		if item == nil || item.DeletedAt != nil {
			return CopyResult{}, notFound("Item", id)
		}
		return CopyResult{Text: item.Value, LineCount: 1, ContainsSecret: item.IsSecret}, nil
	}
	group := s.findGroup(id)
	if group == nil || group.DeletedAt != nil {
		return CopyResult{}, notFound("Group", id)
	}
	// Document groups copy the stored document VERBATIM — the identical
	// bytes that were pasted, not a summary or a re-formatting (§40).
	if group.IsDocumentGroup() {
		doc := group.Document
		lines := 0
		if doc != "" {
			lines = strings.Count(doc, "\n") + 1
		}
		return CopyResult{Text: doc, LineCount: lines, ContainsSecret: group.IsSecret}, nil
	}
	members, err := s.groupMembersLocked(id)
	if err != nil {
		return CopyResult{}, err
	}
	block := exchange.FormatGroupBlock(membersToPairs(members))
	containsSecret := false
	for _, m := range members {
		if m.Item.IsSecret {
			containsSecret = true
			break
		}
	}
	return CopyResult{Text: block, LineCount: len(members), ContainsSecret: containsSecret}, nil
}

// GroupCopyText returns the exact text a Copy would put on the clipboard —
// the verbatim document for document groups, the KEY=value block otherwise.
// Exposed ONLY for the manual-copy fallback after a failed clipboard write
// (§40): the normal copy path never carries the payload through the UI.
func (s *Store) GroupCopyText(id string) (string, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	group := s.findGroup(id)
	if group == nil || group.DeletedAt != nil {
		return "", false, notFound("Group", id)
	}
	if group.IsDocumentGroup() {
		return group.Document, group.IsSecret, nil
	}
	members, err := s.groupMembersLocked(id)
	if err != nil {
		return "", false, err
	}
	secret := false
	for _, m := range members {
		if m.Item.IsSecret {
			secret = true
			break
		}
	}
	return exchange.FormatGroupBlock(membersToPairs(members)), secret, nil
}

// MarkUsed records one successful use (useCount + lastUsedAt + daily save).
// It runs AFTER the clipboard write, so it is best-effort by design: a
// stats-save failure must never fail a payload the user already has on the
// clipboard (the caller ignores the error). Missing or deleted entries (a
// delete can race the write) and read-only stores are silent no-ops.
func (s *Store) MarkUsed(kind EntryKind, id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.readOnly {
		return nil
	}
	now := NowISO(s.now())
	if kind == KindItem {
		item := s.findItem(id)
		if item == nil || item.DeletedAt != nil {
			return nil
		}
		item.UseCount++
		item.LastUsedAt = &now
	} else {
		group := s.findGroup(id)
		if group == nil || group.DeletedAt != nil {
			return nil
		}
		group.UseCount++
		group.LastUsedAt = &now
	}
	return s.saveLocked(kindDaily)
}

func membersToPairs(members []Member) []exchange.Member {
	pairs := make([]exchange.Member, len(members))
	for i, m := range members {
		pairs[i] = exchange.Member{Key: m.Key, Value: m.Item.Value}
	}
	return pairs
}

// Version returns the snapshot generation (see the Store field doc):
// callers can memoize State()-derived data and re-derive only when the
// version moves.
func (s *Store) Version() uint64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.version
}

// ClearRecoveredNotice dismisses the recovery banner.
func (s *Store) ClearRecoveredNotice() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.version++ // in-memory snapshot change without a disk write
	s.recoveredNotice = nil
}

// RestoreBackup replaces the data with a named backup (§5.9 Data list).
func (s *Store) RestoreBackup(name string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.assertWritable(); err != nil {
		return err
	}
	safe := filepath.Base(name)
	if !backupNameRe.MatchString(safe) {
		return errors.New("Invalid backup name")
	}
	text, err := os.ReadFile(filepath.Join(s.backupsDir(), safe))
	if err != nil {
		return errors.New("This backup could not be read.")
	}
	parsed, ok := s.parseVault(string(text))
	if !ok {
		return errors.New("This backup is not valid.")
	}
	if err := s.saveLocked(kindPreRestore); err != nil {
		return err
	}
	s.data = parsed
	s.data.AppVersion = s.appVersion
	/* v1.4.1 (DECISIONS.md §42): restoring a backup is the user
	   explicitly choosing a past state — every tombstone is forgotten,
	   so whatever the backup brings back stays. */
	s.clearTombsLocked()
	return s.writeAtomicLocked()
}

// Reopen re-reads the data file from disk (used after external restore).
func (s *Store) Reopen() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.version++ // the re-read can replace the whole snapshot
	text, err := os.ReadFile(s.dataFile())
	if err != nil {
		return err
	}
	parsed, ok := s.parseVault(string(text))
	if !ok {
		return errors.New("The data file is no longer valid.")
	}
	s.data = parsed
	s.readOnly = parsed.SchemaVersion > CurrentSchemaVersion
	if s.readOnly {
		reason := NewerVersionMessage
		s.readOnlyReason = &reason
	} else {
		s.readOnlyReason = nil
	}
	/* v1.4.1: same load-time guarantees as a fresh start — reload the
	   tombstone log and re-apply it to whatever the file now says. */
	s.tombs = s.loadTombsLocked()
	return s.finishLoadLocked()
}
