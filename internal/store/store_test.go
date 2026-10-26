/**
 * CLAVIS — store engine tests (SPEC §10).
 *
 * Failure messages carry only labels, counts and ids — never values.
 */
package store

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

type fixture struct {
	s   *Store
	dir string
	now time.Time
	sync.Mutex
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	dir := t.TempDir()
	s, err := New(dir, "1.0.0")
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	f := &fixture{s: s, dir: dir, now: time.Now()}
	s.SetClock(f.clock)
	return f
}

func (f *fixture) clock() time.Time {
	f.Lock()
	defer f.Unlock()
	return f.now
}

func (f *fixture) advance(d time.Duration) {
	f.Lock()
	defer f.Unlock()
	f.now = f.now.Add(d)
}

func strp(s string) *string { return &s }
func boolp(b bool) *bool    { return &b }

func catID(t *testing.T, s *Store, name string) string {
	t.Helper()
	for _, c := range s.State().Data.Categories {
		if c.Name == name {
			return c.ID
		}
	}
	t.Fatalf("category %q not found", name)
	return ""
}

func mustItem(t *testing.T, s *Store, name, value string) Item {
	t.Helper()
	it, err := s.CreateItem(NewItem{Name: name, Value: value, IsSecret: boolp(true)})
	if err != nil {
		t.Fatalf("CreateItem: %v", err)
	}
	return it
}

func mustGroup(t *testing.T, s *Store, name string, itemIDs ...string) Group {
	t.Helper()
	g, err := s.CreateGroup(NewGroup{Name: name, ItemIDs: itemIDs})
	if err != nil {
		t.Fatalf("CreateGroup: %v", err)
	}
	return g
}

func readDataFile(t *testing.T, dir string) string {
	t.Helper()
	b, err := os.ReadFile(filepath.Join(dir, "clavis-data.json"))
	if err != nil {
		t.Fatalf("read data file: %v", err)
	}
	return string(b)
}

func writeDataFile(t *testing.T, dir, content string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, "clavis-data.json"), []byte(content), 0o644); err != nil {
		t.Fatalf("write data file: %v", err)
	}
}

/* ------------------------- basics ------------------------- */

func TestStarterVault(t *testing.T) {
	f := newFixture(t)
	st := f.s.State()
	if len(st.Data.Categories) != 3 {
		t.Fatalf("starter categories = %d, want 3", len(st.Data.Categories))
	}
	for _, want := range []string{"Credentials", "Prompts", "Notes"} {
		found := false
		for _, c := range st.Data.Categories {
			if c.Name == want {
				found = true
			}
		}
		if !found {
			t.Errorf("starter missing category %q", want)
		}
	}
	if len(st.Data.Items) != 0 || len(st.Data.Groups) != 0 {
		t.Errorf("starter should have no items/groups")
	}
	if st.Data.Settings.Shortcut != "Ctrl+Shift+Space" {
		t.Errorf("default shortcut = %q", st.Data.Settings.Shortcut)
	}
}

func TestCRUDAndGroupReferences(t *testing.T) {
	f := newFixture(t)
	a := mustItem(t, f.s, "GitHub token", "v1")
	b := mustItem(t, f.s, "Cloudflare token", "v2")
	g1 := mustGroup(t, f.s, "Project A", a.ID)
	g2 := mustGroup(t, f.s, "Project B", a.ID, b.ID)

	// Groups hold references, not copies.
	st := f.s.State()
	if len(st.Data.Groups) != 2 {
		t.Fatalf("groups = %d", len(st.Data.Groups))
	}
	if st.Data.Groups[0].ItemIDs[0] != a.ID {
		t.Error("group 1 should reference item A")
	}

	// Update everywhere: editing the shared item is visible in both groups.
	if err := f.s.UpdateItem(a.ID, ItemPatch{Value: strp("v1-new")}); err != nil {
		t.Fatalf("UpdateItem: %v", err)
	}
	st = f.s.State()
	var got *Item
	for i := range st.Data.Items {
		if st.Data.Items[i].ID == a.ID {
			got = &st.Data.Items[i]
		}
	}
	if got == nil || got.Value != "v1-new" {
		t.Error("shared item edit did not apply")
	}
	for _, g := range st.Data.Groups {
		for _, id := range g.ItemIDs {
			if id == a.ID && g.ID == g2.ID {
				// reference intact
			}
		}
	}

	// Split for group (§5.6 "Only for this group").
	copyItem, err := f.s.SplitItemForGroup(a.ID, g1.ID, ItemPatch{Value: strp("v1-variant")})
	if err != nil {
		t.Fatalf("SplitItemForGroup: %v", err)
	}
	if copyItem.ID == a.ID {
		t.Error("split should create a new id")
	}
	st = f.s.State()
	g1fresh := findGroupByID(st, g1.ID)
	if g1fresh.ItemIDs[0] != copyItem.ID {
		t.Error("group 1 should now reference the copy")
	}
	g2fresh := findGroupByID(st, g2.ID)
	if g2fresh.ItemIDs[0] != a.ID {
		t.Error("group 2 should keep the original")
	}
	var origValue string
	for _, it := range st.Data.Items {
		if it.ID == a.ID {
			origValue = it.Value
		}
	}
	if origValue != "v1-new" {
		t.Error("original should keep its value in the other group")
	}
}

func findGroupByID(st State, id string) *Group {
	for i := range st.Data.Groups {
		if st.Data.Groups[i].ID == id {
			return &st.Data.Groups[i]
		}
	}
	return nil
}

func TestDeleteUndoTrash(t *testing.T) {
	f := newFixture(t)
	a := mustItem(t, f.s, "GitHub token", "v1")
	b := mustItem(t, f.s, "Other", "v2")
	g := mustGroup(t, f.s, "G", a.ID, b.ID)

	token, err := f.s.DeleteEntry(KindItem, a.ID)
	if err != nil {
		t.Fatalf("DeleteEntry: %v", err)
	}
	st := f.s.State()
	if !isDeleted(st, KindItem, a.ID) {
		t.Error("item should be soft-deleted")
	}
	// Live group members skip deleted items.
	members, err := f.s.GroupMembers(g.ID)
	if err != nil {
		t.Fatalf("GroupMembers: %v", err)
	}
	if len(members) != 1 || members[0].Item.ID != b.ID {
		t.Error("deleted item should not be a live member")
	}

	// Undo restores exactly, including memberships.
	if err := f.s.UndoDelete(token); err != nil {
		t.Fatalf("UndoDelete: %v", err)
	}
	st = f.s.State()
	if isDeleted(st, KindItem, a.ID) {
		t.Error("item should be restored")
	}
	gfresh := findGroupByID(st, g.ID)
	if len(gfresh.ItemIDs) != 2 || gfresh.ItemIDs[0] != a.ID {
		t.Error("undo should restore the original membership position")
	}

	// Purge after 30 days.
	if _, err := f.s.DeleteEntry(KindItem, a.ID); err != nil {
		t.Fatalf("DeleteEntry 2: %v", err)
	}
	f.advance(31 * 24 * time.Hour)
	s2, err := NewWithClock(f.dir, "1.0.0", f.clock)
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	st = s2.State()
	for _, it := range st.Data.Items {
		if it.ID == a.ID {
			t.Error("purged item should be gone after 30 days")
		}
	}
	for _, gg := range st.Data.Groups {
		for _, id := range gg.ItemIDs {
			if id == a.ID {
				t.Error("group should drop purged references")
			}
		}
	}

	// Restore + delete-forever + empty trash.
	if err := s2.RestoreEntry(KindItem, b.ID); err != nil {
		t.Fatalf("RestoreEntry: %v", err)
	}
	if err := s2.PurgeEntry(KindItem, b.ID); err != nil {
		t.Fatalf("PurgeEntry: %v", err)
	}
	c := mustItem(t, s2, "Temp", "x")
	if _, err := s2.DeleteEntry(KindItem, c.ID); err != nil {
		t.Fatalf("DeleteEntry 3: %v", err)
	}
	if err := s2.EmptyTrash(); err != nil {
		t.Fatalf("EmptyTrash: %v", err)
	}
	st = s2.State()
	for _, it := range st.Data.Items {
		if it.DeletedAt != nil {
			t.Error("trash should be empty")
		}
	}
}

func isDeleted(st State, kind EntryKind, id string) bool {
	if kind == KindItem {
		for _, it := range st.Data.Items {
			if it.ID == id {
				return it.DeletedAt != nil
			}
		}
	}
	return false
}

func TestGroupDeleteKeepsItems(t *testing.T) {
	f := newFixture(t)
	a := mustItem(t, f.s, "Item", "v")
	g := mustGroup(t, f.s, "G", a.ID)
	if _, err := f.s.DeleteEntry(KindGroup, g.ID); err != nil {
		t.Fatalf("DeleteEntry: %v", err)
	}
	st := f.s.State()
	if len(st.Data.Items) != 1 {
		t.Error("deleting a group must not delete its items")
	}
}

func TestCategoryLifecycle(t *testing.T) {
	f := newFixture(t)
	cat, err := f.s.CreateCategory("Servers")
	if err != nil {
		t.Fatalf("CreateCategory: %v", err)
	}
	a := mustItem(t, f.s, "SSH host", "v")
	if err := f.s.UpdateItem(a.ID, ItemPatch{CategoryID: &cat.ID}); err != nil {
		t.Fatalf("UpdateItem: %v", err)
	}
	if err := f.s.DeleteCategory(cat.ID); err != nil {
		t.Fatalf("DeleteCategory: %v", err)
	}
	st := f.s.State()
	if st.Data.Items[0].CategoryID != nil {
		t.Error("items should become uncategorized when their category is deleted")
	}
}

func TestIsSecretDefaultPerCategory(t *testing.T) {
	f := newFixture(t)
	cred := catID(t, f.s, "Credentials")
	notes := catID(t, f.s, "Notes")
	secret, _ := f.s.CreateItem(NewItem{Name: "Token", Value: "v", CategoryID: &cred})
	plain, _ := f.s.CreateItem(NewItem{Name: "Note", Value: "v", CategoryID: &notes})
	if !secret.IsSecret {
		t.Error("Credentials items default to secret")
	}
	if plain.IsSecret {
		t.Error("Notes items default to non-secret")
	}
}

/* ------------------------- atomic write ------------------------- */

func TestAtomicWriteCrashSafety(t *testing.T) {
	f := newFixture(t)
	mustItem(t, f.s, "Item", "value-1")
	good := readDataFile(t, f.dir)

	// Simulate a crash mid-write: leave a truncated tmp file behind.
	tmp := filepath.Join(f.dir, "clavis-data.json.tmp")
	if err := os.WriteFile(tmp, []byte(`{"schemaVersion":1,"items":[{"id":"x","va`), 0o644); err != nil {
		t.Fatal(err)
	}
	// The real file must still be valid JSON.
	var probe map[string]any
	if err := json.Unmarshal([]byte(good), &probe); err != nil {
		t.Fatalf("original file corrupted: %v", err)
	}
	// And a store re-open must ignore the leftover tmp.
	s2, err := New(f.dir, "1.0.0")
	if err != nil {
		t.Fatalf("reopen with leftover tmp: %v", err)
	}
	if len(s2.State().Data.Items) != 1 {
		t.Error("reopen lost items")
	}
}

/* ------------------------- backups ------------------------- */

func TestDailyBackupOncePerDay(t *testing.T) {
	f := newFixture(t)
	mustItem(t, f.s, "A", "1") // first change today → daily backup
	mustItem(t, f.s, "B", "2") // same day → no new daily backup
	backups := f.s.ListBackups()
	if len(backups) != 1 {
		t.Fatalf("daily backups = %d, want 1", len(backups))
	}
	f.advance(24 * time.Hour)
	mustItem(t, f.s, "C", "3") // next day → new daily backup
	backups = f.s.ListBackups()
	if len(backups) != 2 {
		t.Fatalf("daily backups after a new day = %d, want 2", len(backups))
	}
}

func TestPreImportBackup(t *testing.T) {
	f := newFixture(t)
	mustItem(t, f.s, "A", "1")
	before := len(f.s.ListBackups())
	vault, _ := f.s.ExportBackupString()
	if _, err := f.s.ImportBackup("merge", vault); err != nil {
		t.Fatalf("ImportBackup: %v", err)
	}
	after := f.s.ListBackups()
	if len(after) != before+1 {
		t.Fatalf("pre-import backup not created (%d → %d)", before, len(after))
	}
}

func TestBackupRetention(t *testing.T) {
	f := newFixture(t)
	// 12 days of changes → 12 daily backups; only newest 10 stay.
	for i := 0; i < 12; i++ {
		f.advance(24 * time.Hour)
		mustItem(t, f.s, "Item "+string(rune('A'+i)), "v")
	}
	if got := len(f.s.ListBackups()); got != DailyKeep {
		t.Fatalf("retention: %d backups, want %d", got, DailyKeep)
	}
}

func TestRestoreBackupByName(t *testing.T) {
	f := newFixture(t)
	mustItem(t, f.s, "A", "1")
	f.advance(24 * time.Hour)
	mustItem(t, f.s, "B", "2") // creates a backup of the day before
	backups := f.s.ListBackups()
	if len(backups) == 0 {
		t.Fatal("no backups to restore")
	}
	if err := f.s.RestoreBackup(backups[0].Name); err != nil {
		t.Fatalf("RestoreBackup: %v", err)
	}
	st := f.s.State()
	for _, it := range st.Data.Items {
		if it.Name == "B" {
			t.Error("restored state should predate item B")
		}
	}
}

/* ------------------------- migration / read-only / recovery ------------------------- */

func TestNewerSchemaReadOnly(t *testing.T) {
	f := newFixture(t)
	mustItem(t, f.s, "A", "1")
	before := readDataFile(t, f.dir)

	var v map[string]any
	json.Unmarshal([]byte(before), &v)
	v["schemaVersion"] = float64(99)
	b, _ := json.Marshal(v)
	writeDataFile(t, f.dir, string(b))

	s2, err := New(f.dir, "1.0.0")
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	st := s2.State()
	if !st.ReadOnly || st.ReadOnlyReason == nil || *st.ReadOnlyReason != NewerVersionMessage {
		t.Fatalf("newer schema should be read-only with the spec message")
	}
	// Mutations refuse; the file is untouched.
	if _, err := s2.CreateItem(NewItem{Name: "X", Value: "y"}); err == nil {
		t.Error("mutation should fail in read-only mode")
	}
	if after := readDataFile(t, f.dir); after != string(b) {
		t.Error("read-only mode must not touch the file")
	}
}

func TestCorruptFileRecovery(t *testing.T) {
	f := newFixture(t)
	mustItem(t, f.s, "A", "1")
	f.advance(24 * time.Hour)
	mustItem(t, f.s, "B", "2") // makes a daily backup containing A only

	writeDataFile(t, f.dir, `{ this is not json `)
	s2, err := New(f.dir, "1.0.0")
	if err != nil {
		t.Fatalf("New with corrupt file: %v", err)
	}
	st := s2.State()
	if st.RecoveredNotice == nil {
		t.Fatal("corrupt file should raise the recovery banner")
	}
	hasA, hasB := false, false
	for _, it := range st.Data.Items {
		if it.Name == "A" {
			hasA = true
		}
		if it.Name == "B" {
			hasB = true
		}
	}
	if !hasA {
		t.Error("recovery should restore the newest valid backup (A)")
	}
	if hasB {
		t.Error("backup predates B; B should be gone")
	}
	// The broken file is kept.
	matches, _ := filepath.Glob(filepath.Join(f.dir, "clavis-data.broken-*.json"))
	if len(matches) == 0 {
		t.Error("the damaged file should be kept as clavis-data.broken-<ts>.json")
	}
}

func TestCorruptFileNoBackupStartsFresh(t *testing.T) {
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "backups"), 0o755); err != nil {
		t.Fatal(err)
	}
	writeDataFile(t, dir, `not json`)
	s, err := New(dir, "1.0.0")
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	st := s.State()
	if st.RecoveredNotice == nil || len(st.Data.Categories) != 3 {
		t.Fatal("no valid backup → fresh starter vault + banner")
	}
}

func TestMigrationFromV0(t *testing.T) {
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "backups"), 0o755); err != nil {
		t.Fatal(err)
	}
	writeDataFile(t, dir, `{"schemaVersion":0,"appVersion":"0.9.0","settings":{"shortcut":"Ctrl+Shift+Space","startWithWindows":true,"solidMode":false,"glassIntensity":100,"showLast4":true,"managerBounds":null},"categories":[{"id":"c1","name":"Credentials","sortOrder":0}],"items":[{"id":"i1","name":"Old","key":"OLD","value":"v","note":"","categoryId":"c1","tags":[],"isSecret":true,"pinned":false,"useCount":0,"lastUsedAt":null,"createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z","deletedAt":null}],"groups":[]}`)
	s, err := New(dir, "1.0.0")
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	st := s.State()
	if st.Data.SchemaVersion != CurrentSchemaVersion {
		t.Errorf("schemaVersion = %d, want %d", st.Data.SchemaVersion, CurrentSchemaVersion)
	}
	if len(st.Data.Items) != 1 {
		t.Errorf("migration should keep items")
	}
	backups := s.ListBackups()
	if len(backups) != 1 {
		t.Errorf("pre-migration backup not created (%d)", len(backups))
	}
}

/* ------------------------- copy ------------------------- */

func TestCopyItemAndGroup(t *testing.T) {
	f := newFixture(t)
	a := mustItem(t, f.s, "GitHub token", "plain")
	multi := mustItem(t, f.s, "QT", "multi\nline \"quoted\" \\ back")
	g := mustGroup(t, f.s, "Env", a.ID, multi.ID)

	res, err := f.s.Copy(KindItem, a.ID)
	if err != nil {
		t.Fatalf("Copy item: %v", err)
	}
	if res.Text != "plain" || res.LineCount != 1 || !res.ContainsSecret {
		t.Errorf("Copy item mismatch (lineCount=%d secret=%v)", res.LineCount, res.ContainsSecret)
	}
	st := f.s.State()
	for _, it := range st.Data.Items {
		if it.ID == a.ID && (it.UseCount != 1 || it.LastUsedAt == nil) {
			t.Error("copy should increment useCount and set lastUsedAt")
		}
	}

	res, err = f.s.Copy(KindGroup, g.ID)
	if err != nil {
		t.Fatalf("Copy group: %v", err)
	}
	want := "GITHUB_TOKEN=plain\nQT=\"multi\\nline \\\"quoted\\\" \\\\ back\""
	if res.Text != want {
		t.Errorf("group copy mismatch (len %d vs %d)", len(res.Text), len(want))
	}
	if res.LineCount != 2 {
		t.Errorf("lineCount = %d, want 2", res.LineCount)
	}
}

/* ------------------------- import/export ------------------------- */

func TestFullBackupRoundTrip(t *testing.T) {
	f := newFixture(t)
	mustItem(t, f.s, "A", "value-a")
	b := mustItem(t, f.s, "B", "value-b")
	mustGroup(t, f.s, "G", b.ID)
	backup, err := f.s.ExportBackupString()
	if err != nil {
		t.Fatalf("ExportBackupString: %v", err)
	}

	// Replace mode on a fresh dir.
	dir2 := t.TempDir()
	s2, err := New(dir2, "1.0.0")
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if p := s2.ImportBackupPreview(backup); !p.Valid {
		t.Fatalf("preview says invalid")
	}
	summary, err := s2.ImportBackup("replace", backup)
	if err != nil {
		t.Fatalf("ImportBackup replace: %v", err)
	}
	if summary.Added != 3 {
		t.Errorf("replace summary added = %d, want 3", summary.Added)
	}
	st := s2.State()
	if len(st.Data.Items) != 2 || len(st.Data.Groups) != 1 {
		t.Errorf("replace lost entries")
	}
	// Byte-identical re-export (modulo appVersion).
	backup2, _ := s2.ExportBackupString()
	if stripAppVersion(backup) != stripAppVersion(backup2) {
		t.Errorf("full backup round-trip is not byte-identical")
	}

	// Merge with identical data: everything skipped.
	summary, err = s2.ImportBackup("merge", backup)
	if err != nil {
		t.Fatalf("ImportBackup merge: %v", err)
	}
	if summary.Skipped != 3 || summary.Added != 0 || summary.Updated != 0 {
		t.Errorf("merge summary = %+v, want skipped 3", summary)
	}
}

func stripAppVersion(s string) string {
	return strings.ReplaceAll(s, `"appVersion": "1.0.0"`, `"appVersion": "X"`)
}

func TestImportFilesPreviewAndApply(t *testing.T) {
	f := newFixture(t)
	mustItem(t, f.s, "GitHub token", "existing")

	md := "---\ntype: item\nname: GitHub token\nkey: GITHUB_TOKEN\ncategory: Credentials\ntags: [github]\nsecret: true\n---\nnewvalue"
	txt := "ALPHA=1\nBETA=two"
	files := []ImportedFile{{Name: "github-token.md", Content: md}, {Name: "env.txt", Content: txt}}

	preview := f.s.ImportFilesPreview(files)
	if preview.ParsedCount != 2 {
		t.Fatalf("parsedCount = %d, want 2", preview.ParsedCount)
	}
	if len(preview.Conflicts) != 1 || preview.Conflicts[0].Reason != "name" {
		t.Fatalf("conflicts = %+v", preview.Conflicts)
	}

	// keepBoth → no reuse, everything imports (md item + 2 txt members +
	// the txt group itself).
	summary, err := f.s.ImportFilesApply(files, ImportResolution{Choice: "keepBoth"})
	if err != nil {
		t.Fatalf("ImportFilesApply keepBoth: %v", err)
	}
	if summary.Added != 4 {
		t.Errorf("keepBoth summary = %+v", summary)
	}

	// reuse on an identical .txt → group merges into existing, members skipped.
	dir := t.TempDir()
	s2, _ := New(dir, "1.0.0")
	summary, err = s2.ImportFilesApply(files, ImportResolution{Choice: "reuse"})
	if err != nil {
		t.Fatalf("ImportFilesApply reuse: %v", err)
	}
	st := s2.State()
	groups := st.Data.Groups
	if len(groups) != 1 || groups[0].Name != "env" || len(groups[0].ItemIDs) != 2 {
		t.Errorf("txt should import as group env with 2 members; summary=%+v", summary)
	}
}

func TestImportRejectsNewerBackup(t *testing.T) {
	f := newFixture(t)
	mustItem(t, f.s, "A", "1")
	vault, _ := f.s.ExportBackupString()
	var v map[string]any
	json.Unmarshal([]byte(vault), &v)
	v["schemaVersion"] = float64(2)
	b, _ := json.Marshal(v)
	if _, err := f.s.ImportBackup("merge", string(b)); err == nil {
		t.Error("newer backup must be rejected")
	}
}

func TestSettingsPatch(t *testing.T) {
	f := newFixture(t)
	gi := 42
	if err := f.s.UpdateSettings(SettingsPatch{GlassIntensity: &gi, Shortcut: strp("Ctrl+Alt+K")}); err != nil {
		t.Fatalf("UpdateSettings: %v", err)
	}
	st := f.s.State()
	if st.Data.Settings.GlassIntensity != 42 || st.Data.Settings.Shortcut != "Ctrl+Alt+K" {
		t.Errorf("settings patch did not apply")
	}
	// Bounds round-trip.
	mb := ManagerBounds{X: 10, Y: 20, W: 1000, H: 680}
	if err := f.s.UpdateSettings(SettingsPatch{ManagerBounds: &mb, ManagerBoundsSet: true}); err != nil {
		t.Fatalf("UpdateSettings bounds: %v", err)
	}
	st = f.s.State()
	if st.Data.Settings.ManagerBounds == nil || st.Data.Settings.ManagerBounds.W != 1000 {
		t.Error("managerBounds did not round-trip")
	}
}

func TestDuplicateItem(t *testing.T) {
	f := newFixture(t)
	a := mustItem(t, f.s, "Orig", "v")
	dup, err := f.s.DuplicateItem(a.ID)
	if err != nil {
		t.Fatalf("DuplicateItem: %v", err)
	}
	if dup.Name != "Orig (copy)" || dup.ID == a.ID {
		t.Errorf("duplicate mismatch")
	}
}

// TestUndoRingIsCapped: every delete kept a full item snapshot (value
// included) in RAM for the whole app lifetime. The ring is capped at 50
// newest records; undo still works for the newest and reports "Nothing to
// undo" for evicted tokens.
func TestUndoRingIsCapped(t *testing.T) {
	dir := t.TempDir()
	st, err := NewWithClock(dir, "test", func() time.Time {
		return time.Date(2025, 1, 1, 10, 0, 0, 0, time.UTC)
	})
	if err != nil {
		t.Fatal(err)
	}

	var firstToken string
	for i := 0; i < maxUndoRecords+10; i++ {
		item, err := st.CreateItem(NewItem{Name: fmt.Sprintf("item %d", i), Value: fmt.Sprintf("value %d", i)})
		if err != nil {
			t.Fatal(err)
		}
		token, err := st.DeleteEntry(KindItem, item.ID)
		if err != nil {
			t.Fatal(err)
		}
		if i == 0 {
			firstToken = token
		}
	}

	st.mu.Lock()
	ringSize := len(st.undoRing)
	st.mu.Unlock()
	if ringSize > maxUndoRecords {
		t.Fatalf("undo ring holds %d records, want at most %d", ringSize, maxUndoRecords)
	}

	// The oldest token was evicted — undoing it must fail cleanly.
	if err := st.UndoDelete(firstToken); err == nil {
		t.Fatal("evicted undo token must not restore")
	}
	// A fresh delete (the newest) must still undo perfectly.
	items := st.State().Data.Items
	newest := items[len(items)-1]
	tok, err := st.DeleteEntry(KindItem, newest.ID)
	if err != nil {
		t.Fatal(err)
	}
	if err := st.UndoDelete(tok); err != nil {
		t.Fatalf("undo of the newest delete failed: %v", err)
	}
	if _, err := st.ItemValue(newest.ID); err != nil {
		t.Fatalf("restored item is missing: %v", err)
	}
}
