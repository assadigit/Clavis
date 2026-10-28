/**
 * CLAVIS — store engine tests (SPEC §10).
 *
 * Failure messages carry only labels, counts and ids — never values.
 */
package store

import (
	"encoding/json"
	"errors"
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
	f.s.Close() // v1.4.1: the data-folder lock is exclusive — simulate the process ending
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
	cat, err := f.s.CreateCategory("Servers", nil)
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
	f.s.Close() // v1.4.1: exclusive lock — release before re-opening the folder
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

	f.s.Close() // v1.4.1: exclusive lock — release before re-opening the folder
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
	f.s.Close() // v1.4.1: exclusive lock — release before re-opening the folder
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
	/* Copy only prepares the payload — the counter moves on MarkUsed,
	   after the caller's clipboard write succeeded (never on intent). */
	st := f.s.State()
	for _, it := range st.Data.Items {
		if it.ID == a.ID && (it.UseCount != 0 || it.LastUsedAt != nil) {
			t.Error("Copy alone must not increment useCount or set lastUsedAt")
		}
	}
	if err := f.s.MarkUsed(KindItem, a.ID); err != nil {
		t.Fatalf("MarkUsed item: %v", err)
	}
	st = f.s.State()
	for _, it := range st.Data.Items {
		if it.ID == a.ID && (it.UseCount != 1 || it.LastUsedAt == nil) {
			t.Error("MarkUsed should increment useCount and set lastUsedAt")
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
	if err := f.s.MarkUsed(KindGroup, g.ID); err != nil {
		t.Fatalf("MarkUsed group: %v", err)
	}
	st = f.s.State()
	for _, gr := range st.Data.Groups {
		if gr.ID == g.ID && (gr.UseCount != 1 || gr.LastUsedAt == nil) {
			t.Error("MarkUsed group should increment useCount and set lastUsedAt")
		}
	}
}

// TestMarkUsedEdgeCases pins MarkUsed's best-effort contract: missing or
// deleted entries (a delete can race the clipboard write) are silent no-ops.
func TestMarkUsedEdgeCases(t *testing.T) {
	f := newFixture(t)
	a := mustItem(t, f.s, "A", "v")

	if err := f.s.MarkUsed(KindItem, "missing"); err != nil {
		t.Fatalf("MarkUsed missing item must be a no-op, got %v", err)
	}
	if err := f.s.MarkUsed(KindGroup, "missing"); err != nil {
		t.Fatalf("MarkUsed missing group must be a no-op, got %v", err)
	}

	if _, err := f.s.DeleteEntry(KindItem, a.ID); err != nil {
		t.Fatalf("DeleteEntry: %v", err)
	}
	if err := f.s.MarkUsed(KindItem, a.ID); err != nil {
		t.Fatalf("MarkUsed deleted item must be a no-op, got %v", err)
	}
	st := f.s.State()
	for _, it := range st.Data.Items {
		if it.ID == a.ID && it.UseCount != 0 {
			t.Error("MarkUsed must not touch a deleted item's use stats")
		}
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

// TestVersionBumpsOnEveryStateChange pins the memoization invalidation
// contract for service.stateMap: every path that can change a State()
// snapshot must bump the store version — persisted writes, notice clears,
// reopens — while pure reads never do.
func TestVersionBumpsOnEveryStateChange(t *testing.T) {
	f := newFixture(t)

	v0 := f.s.Version()
	mustItem(t, f.s, "A", "v") // create → save → bump
	if f.s.Version() <= v0 {
		t.Error("a persisted create must bump the version")
	}

	v1 := f.s.Version()
	f.s.ClearRecoveredNotice() // in-memory snapshot change → bump
	if f.s.Version() <= v1 {
		t.Error("ClearRecoveredNotice must bump the version")
	}

	v2 := f.s.Version()
	if err := f.s.Reopen(); err != nil { // re-read from disk → bump
		t.Fatalf("Reopen: %v", err)
	}
	if f.s.Version() <= v2 {
		t.Error("Reopen must bump the version")
	}

	v3 := f.s.Version()
	_ = f.s.State()
	_ = f.s.ListBackups()
	_ = f.s.ReadOnly()
	if f.s.Version() != v3 {
		t.Error("pure reads must not bump the version")
	}
}

/* ── Hierarchical categories (v1.4.0, DECISIONS.md §41) ─────────────────── */

func parentOf(t *testing.T, s *Store, id string) *string {
	t.Helper()
	for _, c := range s.State().Data.Categories {
		if c.ID == id {
			return c.ParentID
		}
	}
	t.Fatalf("category %s vanished", id)
	return nil
}

func TestCreateCategoryNested(t *testing.T) {
	f := newFixture(t)
	projects, err := f.s.CreateCategory("Projects", nil)
	if err != nil {
		t.Fatalf("CreateCategory top: %v", err)
	}
	leaf, err := f.s.CreateCategory("Hibana", &projects.ID)
	if err != nil {
		t.Fatalf("CreateCategory nested: %v", err)
	}
	if p := parentOf(t, f.s, leaf.ID); p == nil || *p != projects.ID {
		t.Errorf("nested category should point at its parent, got %v", p)
	}
	// Empty-string parent is the JSON "absent" form — must behave as top level.
	top, err := f.s.CreateCategory("Lonely", strPtr(""))
	if err != nil {
		t.Fatalf("CreateCategory empty parent: %v", err)
	}
	if p := parentOf(t, f.s, top.ID); p != nil {
		t.Errorf("empty parent should mean top level, got %v", *p)
	}
	// Unknown parent is refused loudly.
	if _, err := f.s.CreateCategory("Ghost", strPtr("no-such-id")); err == nil {
		t.Error("unknown parent must be rejected")
	}
}

func TestSetCategoryParent(t *testing.T) {
	f := newFixture(t)
	a, _ := f.s.CreateCategory("A", nil)
	b, _ := f.s.CreateCategory("B", &a.ID)
	c, _ := f.s.CreateCategory("C", &b.ID)

	if err := f.s.SetCategoryParent(c.ID, nil); err != nil {
		t.Fatalf("move to top: %v", err)
	}
	if p := parentOf(t, f.s, c.ID); p != nil {
		t.Errorf("C should now be top level, got %v", *p)
	}
	if err := f.s.SetCategoryParent(c.ID, &a.ID); err != nil {
		t.Fatalf("move under A: %v", err)
	}
	if p := parentOf(t, f.s, c.ID); p == nil || *p != a.ID {
		t.Errorf("C should be under A, got %v", p)
	}

	if err := f.s.SetCategoryParent(a.ID, &a.ID); err == nil {
		t.Error("self-parent must be rejected")
	}
	if err := f.s.SetCategoryParent(a.ID, &c.ID); err == nil {
		t.Error("moving A under its own descendant C must be rejected")
	}
	if err := f.s.SetCategoryParent(a.ID, strPtr("no-such-id")); err == nil {
		t.Error("unknown parent must be rejected")
	}
	if err := f.s.SetCategoryParent("no-such-id", nil); err == nil {
		t.Error("unknown category must be rejected")
	}

	// Depth cap: build a MaxCategoryDepth chain under A, then verify both
	// creation and re-parenting refuse to go one level deeper.
	deep := a.ID
	for i := 1; i < MaxCategoryDepth; i++ {
		next, err := f.s.CreateCategory(fmt.Sprintf("d%d", i), &deep)
		if err != nil {
			t.Fatalf("chain build at %d: %v", i, err)
		}
		deep = next.ID // ends at depth MaxCategoryDepth
	}
	if _, err := f.s.CreateCategory("over", &deep); err == nil {
		t.Error("creating beyond the depth cap must be rejected")
	}
	// c is a leaf under A; moving it under deep (depth 8) would make it 9.
	if err := f.s.SetCategoryParent(c.ID, &deep); err == nil {
		t.Error("re-parenting beyond the depth cap must be rejected")
	}
	// Moving under the grandparent-ish level that still fits is allowed:
	// climb from deep until depth(parent)+1 <= cap-… find depth-7 ancestor.
	fit := deep
	for f.s.categoryDepthLockedForTest(fit) > MaxCategoryDepth-1 {
		fit = *parentOf(t, f.s, fit)
	}
	if err := f.s.SetCategoryParent(c.ID, &fit); err != nil {
		t.Fatalf("move to depth %d should be allowed: %v", f.s.categoryDepthLockedForTest(fit)+1, err)
	}
}

// categoryDepthLockedForTest exposes chain depth for test assertions.
func (s *Store) categoryDepthLockedForTest(id string) int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.categoryDepthLocked(id)
}

func TestCreateCategoryDepthCap(t *testing.T) {
	f := newFixture(t)
	parent, _ := f.s.CreateCategory("root", nil)
	for i := 1; i < MaxCategoryDepth; i++ {
		next, err := f.s.CreateCategory(fmt.Sprintf("lvl%d", i), &parent.ID)
		if err != nil {
			t.Fatalf("depth %d should be fine: %v", i, err)
		}
		parent = next
	}
	if _, err := f.s.CreateCategory("too deep", &parent.ID); err == nil {
		t.Errorf("creating beyond depth %d must be rejected", MaxCategoryDepth)
	}
}

func TestDeleteCategoryPromotesChildren(t *testing.T) {
	f := newFixture(t)
	top, _ := f.s.CreateCategory("Projects", nil)
	mid, _ := f.s.CreateCategory("Client work", &top.ID)
	leaf, _ := f.s.CreateCategory("Hibana", &mid.ID)

	mustItem(t, f.s, "i-top", "v")
	it := mustItem(t, f.s, "i-leaf", "v")
	if err := f.s.UpdateItem(it.ID, ItemPatch{CategoryID: &leaf.ID}); err != nil {
		t.Fatalf("UpdateItem: %v", err)
	}

	// Delete the MIDDLE category: its child lifts to top's level; the item in
	// the deleted category becomes uncategorized; nothing else is deleted.
	if err := f.s.DeleteCategory(mid.ID); err != nil {
		t.Fatalf("DeleteCategory: %v", err)
	}
	if p := parentOf(t, f.s, leaf.ID); p == nil || *p != top.ID {
		t.Errorf("orphaned child should lift to the deleted category's parent, got %v", p)
	}
	st := f.s.State()
	ids := map[string]bool{}
	for _, c := range st.Data.Categories {
		ids[c.ID] = true
	}
	if !ids[top.ID] || !ids[leaf.ID] {
		t.Error("delete must not cascade to other categories")
	}
	if ids[mid.ID] {
		t.Error("deleted category must be gone")
	}
	for _, i := range st.Data.Items {
		if i.ID == it.ID {
			// The item lives in the LEAF, which survived the mid-level delete
			// (promoted, not removed) — so it must still be categorized there.
			if i.CategoryID == nil || *i.CategoryID != leaf.ID {
				t.Error("items in a surviving (promoted) subcategory must keep their category")
			}
		}
	}

	// Deleting a TOP category sends its grandchildren to the top level.
	if err := f.s.DeleteCategory(top.ID); err != nil {
		t.Fatalf("DeleteCategory top: %v", err)
	}
	if p := parentOf(t, f.s, leaf.ID); p != nil {
		t.Errorf("children of a deleted top category become top level, got %v", *p)
	}

	// Deleting the LEAF itself uncategorizes only its own items.
	if err := f.s.DeleteCategory(leaf.ID); err != nil {
		t.Fatalf("DeleteCategory leaf: %v", err)
	}
	st2 := f.s.State()
	for _, i := range st2.Data.Items {
		if i.ID == it.ID && i.CategoryID != nil {
			t.Error("items of the deleted category become uncategorized")
		}
	}
}

func TestNormalizeCategoryTreeSanitization(t *testing.T) {
	// Dangling parent, self-parent, and a 2-cycle all drop to top level.
	raw := map[string]any{
		"schemaVersion": float64(1),
		"categories": []any{
			map[string]any{"id": "a", "name": "A", "sortOrder": 0},
			map[string]any{"id": "b", "name": "B", "sortOrder": 1, "parentId": "ghost"},
			map[string]any{"id": "c", "name": "C", "sortOrder": 2, "parentId": "c"},
			map[string]any{"id": "d", "name": "D", "sortOrder": 3, "parentId": "e"},
			map[string]any{"id": "e", "name": "E", "sortOrder": 4, "parentId": "d"},
			map[string]any{"id": "f", "name": "F", "sortOrder": 5, "parentId": "a"},
		},
		"items":  []any{},
		"groups": []any{},
	}
	v, ok := NormalizeVault(raw, "1.4.0", "2025-01-01T00:00:00.000Z", NewUUID)
	if !ok {
		t.Fatal("NormalizeVault: expected ok")
	}
	for _, c := range v.Categories {
		switch c.ID {
		case "b", "c", "d", "e":
			if c.ParentID != nil {
				t.Errorf("%s: broken parent should be cleared, got %v", c.ID, *c.ParentID)
			}
		case "f":
			if c.ParentID == nil || *c.ParentID != "a" {
				t.Error("f: healthy parent must survive")
			}
		}
	}
}

func TestNormalizeCategoryDepthLift(t *testing.T) {
	// A hand-written 12-deep chain must be lifted to at most MaxCategoryDepth.
	cats := []any{map[string]any{"id": "n0", "name": "n0", "sortOrder": 0}}
	for i := 1; i <= 12; i++ {
		cats = append(cats, map[string]any{
			"id": fmt.Sprintf("n%d", i), "name": fmt.Sprintf("n%d", i),
			"sortOrder": i, "parentId": fmt.Sprintf("n%d", i-1),
		})
	}
	raw := map[string]any{
		"schemaVersion": float64(1),
		"categories":    cats,
		"items":         []any{},
		"groups":        []any{},
	}
	v, ok := NormalizeVault(raw, "1.4.0", "2025-01-01T00:00:00.000Z", NewUUID)
	if !ok {
		t.Fatal("NormalizeVault: expected ok")
	}
	byID := map[string]Category{}
	for _, c := range v.Categories {
		byID[c.ID] = c
	}
	depth := func(id string) int {
		d := 1
		for byID[id].ParentID != nil {
			id = *byID[id].ParentID
			d++
		}
		return d
	}
	for _, c := range v.Categories {
		if d := depth(c.ID); d > MaxCategoryDepth {
			t.Errorf("%s ends up at depth %d (cap %d)", c.ID, d, MaxCategoryDepth)
		}
	}
	// The chain order itself must survive (each node still has a parent).
	if byID["n12"].ParentID == nil {
		t.Error("deep nodes must be lifted, not detached to top level")
	}
}

func strPtr(s string) *string { return &s }

/* ── v1.4.1: deletions stick (DECISIONS.md §42) ─────────────────────────── */

// liveifyEntry returns the vault text with the entry's deletedAt cleared.
func liveifyEntry(t *testing.T, text, id string) string {
	t.Helper()
	var v map[string]any
	if err := json.Unmarshal([]byte(text), &v); err != nil {
		t.Fatalf("liveify: parse: %v", err)
	}
	for _, key := range []string{"items", "groups"} {
		arr, _ := v[key].([]any)
		for _, e := range arr {
			if m, ok := e.(map[string]any); ok && m["id"] == id {
				m["deletedAt"] = nil
			}
		}
	}
	b, _ := json.Marshal(v)
	return string(b)
}

// resurrectEntry simulates the reported bug's mechanism: something (a stale
// second copy of the app, an old backup) rewrites the data file with the
// entry LIVE again.
func resurrectEntry(t *testing.T, dir, id string) {
	t.Helper()
	writeDataFile(t, dir, liveifyEntry(t, readDataFile(t, dir), id))
}

func TestDeletedEntriesStayDeleted(t *testing.T) {
	f := newFixture(t)
	a := mustItem(t, f.s, "Ghost key", "v")
	if _, err := f.s.DeleteEntry(KindItem, a.ID); err != nil {
		t.Fatalf("DeleteEntry: %v", err)
	}

	// The reported mechanism: the file gets rewritten with the entry live.
	resurrectEntry(t, f.dir, a.ID)
	f.s.Close()
	s2, err := New(f.dir, "1.0.0")
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	st := s2.State()
	if !isDeleted(st, KindItem, a.ID) {
		t.Fatal("a deleted entry that reappeared in the file must be moved back to the Trash (v1.4.1 tombstones)")
	}
	if st.RecoveredNotice == nil {
		t.Fatal("the re-applied deletions must be explained by a banner")
	}
	// And the correction must be persisted, not just in-memory.
	var onDisk map[string]any
	if err := json.Unmarshal([]byte(readDataFile(t, f.dir)), &onDisk); err != nil {
		t.Fatalf("disk parse: %v", err)
	}
	for _, e := range onDisk["items"].([]any) {
		if m := e.(map[string]any); m["id"] == a.ID {
			if m["deletedAt"] == nil {
				t.Fatal("the resurrected entry must be re-deleted ON DISK")
			}
		}
	}
}

func TestTombstoneClearedByRestoreEntry(t *testing.T) {
	f := newFixture(t)
	a := mustItem(t, f.s, "Keep me", "v")
	if _, err := f.s.DeleteEntry(KindItem, a.ID); err != nil {
		t.Fatalf("DeleteEntry: %v", err)
	}
	if err := f.s.RestoreEntry(KindItem, a.ID); err != nil {
		t.Fatalf("RestoreEntry: %v", err)
	}
	// Even if an old copy later resurrects the file entry, the user's
	// explicit restore must win: no tombstone is left to fight it.
	resurrectEntry(t, f.dir, a.ID)
	f.s.Close()
	s2, err := New(f.dir, "1.0.0")
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	if isDeleted(s2.State(), KindItem, a.ID) {
		t.Fatal("an intentionally restored entry must stay live")
	}
}

func TestTombstoneClearedByUndo(t *testing.T) {
	f := newFixture(t)
	a := mustItem(t, f.s, "Undo me", "v")
	token, err := f.s.DeleteEntry(KindItem, a.ID)
	if err != nil {
		t.Fatalf("DeleteEntry: %v", err)
	}
	if err := f.s.UndoDelete(token); err != nil {
		t.Fatalf("UndoDelete: %v", err)
	}
	resurrectEntry(t, f.dir, a.ID)
	f.s.Close()
	s2, err := New(f.dir, "1.0.0")
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	if isDeleted(s2.State(), KindItem, a.ID) {
		t.Fatal("an undone delete must stay live")
	}
}

func TestEmptyTrashKeepsTombstones(t *testing.T) {
	f := newFixture(t)
	a := mustItem(t, f.s, "Gone for good", "v")
	if _, err := f.s.DeleteEntry(KindItem, a.ID); err != nil {
		t.Fatalf("DeleteEntry: %v", err)
	}
	// Snapshot while the entry is still in the file (in Trash) — the state a
	// stale copy of the app would still hold in memory.
	stale := liveifyEntry(t, readDataFile(t, f.dir), a.ID)
	if err := f.s.EmptyTrash(); err != nil {
		t.Fatalf("EmptyTrash: %v", err)
	}
	// The stale copy rewrites its older snapshot, entry live.
	writeDataFile(t, f.dir, stale)
	f.s.Close()
	s2, err := New(f.dir, "1.0.0")
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	if !isDeleted(s2.State(), KindItem, a.ID) {
		t.Fatal("an emptied-trash entry that reappears must be re-deleted")
	}
}

func TestRestoreBackupClearsTombstones(t *testing.T) {
	f := newFixture(t)
	a := mustItem(t, f.s, "Before backup", "v")
	f.advance(24 * time.Hour)
	mustItem(t, f.s, "Triggers daily backup", "v") // backup contains a live
	backups := f.s.ListBackups()
	if len(backups) == 0 {
		t.Fatal("expected a daily backup")
	}
	name := backups[len(backups)-1].Name // newest

	if _, err := f.s.DeleteEntry(KindItem, a.ID); err != nil {
		t.Fatalf("DeleteEntry: %v", err)
	}
	if err := f.s.RestoreBackup(name); err != nil {
		t.Fatalf("RestoreBackup: %v", err)
	}
	// The user explicitly chose the past state: the restored entry must be
	// live now AND stay live across reloads (tombstones were cleared).
	f.s.Close()
	s2, err := New(f.dir, "1.0.0")
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	if isDeleted(s2.State(), KindItem, a.ID) {
		t.Fatal("RestoreBackup is an explicit user choice — the entry must stay live")
	}
}

func TestDataFolderLockExclusive(t *testing.T) {
	dir := t.TempDir()
	s1, err := New(dir, "1.0.0")
	if err != nil {
		t.Fatalf("first New: %v", err)
	}
	if _, err := New(dir, "1.0.0"); err == nil {
		t.Fatal("a second store on the same data folder must be refused (v1.4.1)")
	} else if !strings.Contains(err.Error(), "already running") {
		t.Fatalf("expected the friendly double-launch error, got: %v", err)
	}
	s1.Close()
	s2, err := New(dir, "1.0.0")
	if err != nil {
		t.Fatalf("New after Close: %v", err)
	}
	s2.Close()
}

func TestTmpFilesUniqueAndSwept(t *testing.T) {
	dir := t.TempDir()
	s, err := New(dir, "1.0.0")
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	mustItem(t, s, "A", "1")
	mustItem(t, s, "B", "2")
	// No plain shared tmp file may linger after writes.
	if _, err := os.Stat(filepath.Join(dir, "clavis-data.json.tmp")); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("writes must not leave a shared clavis-data.json.tmp behind")
	}
	// A dead writer's tmp file is garbage and must be swept on next open.
	stale := filepath.Join(dir, "clavis-data.json.tmp-999-1")
	if err := os.WriteFile(stale, []byte("garbage"), 0o644); err != nil {
		t.Fatal(err)
	}
	s.Close()
	s2, err := New(dir, "1.0.0")
	if err != nil {
		t.Fatalf("New after sweep: %v", err)
	}
	defer s2.Close()
	if _, err := os.Stat(stale); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("a leftover tmp file from a dead writer must be swept on open")
	}
}
