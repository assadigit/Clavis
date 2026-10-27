/**
 * CLAVIS — fragment export/import tests (UI-audit round 1, Phase 4; F-017).
 *
 * The owner's contract: export one group (or item), import it later or on
 * another machine, lose nothing. Failure messages carry labels, counts and
 * ids only — never values.
 */
package store

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// fragFixture builds a store with a rich group: 3 items, one of them with
// note+tags+isSecret+pinned+useCount+lastUsedAt set, plus the group's category.
func fragFixture(t *testing.T) (*fixture, Group, []Item, string) {
	t.Helper()
	f := newFixture(t)
	cat := mustCategory(t, f.s, "Work")
	items := []Item{
		mustItem(t, f.s, "FAKE GitHub token", "FAKE-GITHUB-TOKEN-1234567890abcdef"),
		mustItem(t, f.s, "FAKE Database URL", "postgres://FAKE:pw@db:5432/app"),
		mustItem(t, f.s, "FAKE Deploy note", "note value FAKE"),
	}
	// Rich metadata on the first item.
	if err := f.s.UpdateItem(items[0].ID, ItemPatch{
		Key:      strp("GITHUB_TOKEN"),
		Note:     strp("personal access token — fake"),
		Tags:     &[]string{"github", "ci"},
		IsSecret: boolp(true),
		Pinned:   boolp(true),
	}); err != nil {
		t.Fatalf("UpdateItem: %v", err)
	}
	if err := f.s.MarkUsed(KindItem, items[0].ID); err != nil {
		t.Fatalf("MarkUsed: %v", err)
	}
	f.advance(1)
	group := mustGroup(t, f.s, "FAKE Deploy set", items[0].ID, items[1].ID, items[2].ID)
	if err := f.s.UpdateGroup(group.ID, GroupPatch{CategoryID: &cat}); err != nil {
		t.Fatalf("UpdateGroup: %v", err)
	}
	// Re-read everything from state so the callers see the stored (patched)
	// rows — the create-time snapshots don't carry the updates.
	state := f.s.State()
	for i := range state.Data.Items {
		for j := range items {
			if state.Data.Items[i].ID == items[j].ID {
				items[j] = state.Data.Items[i]
			}
		}
	}
	for _, g := range state.Data.Groups {
		if g.ID == group.ID {
			group = g
		}
	}
	return f, group, items, cat
}

func mustCategory(t *testing.T, s *Store, name string) string {
	t.Helper()
	c, err := s.CreateCategory(name)
	if err != nil {
		t.Fatalf("CreateCategory: %v", err)
	}
	return c.ID
}

func exportFragment(t *testing.T, s *Store, kind EntryKind, id string) Fragment {
	t.Helper()
	target, err := s.ExportEntryFragment(kind, id)
	if err != nil {
		t.Fatalf("ExportEntryFragment: %v", err)
	}
	var frag Fragment
	if err := json.Unmarshal([]byte(target.Body), &frag); err != nil {
		t.Fatalf("fragment body is not valid JSON: %v", err)
	}
	return frag
}

func TestFragmentGroupExportIsLossless(t *testing.T) {
	f, group, items, cat := fragFixture(t)
	frag := exportFragment(t, f.s, KindGroup, group.ID)

	if frag.Kind != fragmentKind || frag.FragmentVersion != CurrentFragmentVersion {
		t.Fatalf("bad envelope: kind=%q fragmentVersion=%d", frag.Kind, frag.FragmentVersion)
	}
	if frag.Scope.Type != "group" || frag.Scope.ID != group.ID || frag.Scope.Name != group.Name {
		t.Fatalf("bad scope: %+v", frag.Scope)
	}
	if len(frag.Groups) != 1 || frag.Groups[0].ID != group.ID {
		t.Fatalf("fragment should carry exactly the group, got %d groups", len(frag.Groups))
	}
	if len(frag.Items) != len(items) {
		t.Fatalf("fragment should carry %d items, got %d", len(items), len(frag.Items))
	}
	// Membership order rides along inside the Group row.
	want := []string{items[0].ID, items[1].ID, items[2].ID}
	got := frag.Groups[0].ItemIDs
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("itemIds order not preserved: want %v got %v", want, got)
	}
	// Every Item field byte-equal (incl. note/tags/isSecret/pinned/useCount).
	for i, inc := range frag.Items {
		if inc.ID != items[i].ID {
			t.Fatalf("item %d id mismatch: %s vs %s", i, inc.ID, items[i].ID)
		}
		if inc.Note == "" && inc.ID == items[0].ID {
			t.Fatalf("note lost in export")
		}
		if len(inc.Tags) != len(items[i].Tags) {
			t.Fatalf("tags lost for %s", inc.ID)
		}
	}
	if frag.Items[0].Pinned != true || frag.Items[0].IsSecret != true || frag.Items[0].UseCount == 0 || frag.Items[0].LastUsedAt == nil {
		t.Fatalf("metadata lost: pinned/isSecret/useCount/lastUsedAt must all ride along")
	}
	if frag.Items[0].Key != "GITHUB_TOKEN" {
		t.Fatalf("key lost in export")
	}
	// The referenced category is included.
	found := false
	for _, c := range frag.Categories {
		if c.ID == cat {
			found = true
		}
	}
	if !found {
		t.Fatalf("category %s missing from fragment", cat)
	}
}

func TestFragmentItemExport(t *testing.T) {
	f, _, items, _ := fragFixture(t)
	frag := exportFragment(t, f.s, KindItem, items[0].ID)
	if frag.Scope.Type != "item" || frag.Scope.ID != items[0].ID {
		t.Fatalf("bad scope: %+v", frag.Scope)
	}
	if len(frag.Groups) != 0 {
		t.Fatalf("item fragment must carry no group rows, got %d", len(frag.Groups))
	}
	if len(frag.Items) != 1 || frag.Items[0].ID != items[0].ID {
		t.Fatalf("item fragment must carry exactly the item")
	}
}

func TestFragmentSkipsSoftDeleted(t *testing.T) {
	f, group, items, _ := fragFixture(t)
	if _, err := f.s.DeleteEntry(KindItem, items[2].ID); err != nil {
		t.Fatalf("DeleteEntry: %v", err)
	}
	frag := exportFragment(t, f.s, KindGroup, group.ID)
	for _, inc := range frag.Items {
		if inc.ID == items[2].ID {
			t.Fatalf("soft-deleted member leaked into the fragment")
		}
	}
	if len(frag.Items) != 2 {
		t.Fatalf("expected 2 live members in fragment, got %d", len(frag.Items))
	}
}

func TestFragmentExportNotFound(t *testing.T) {
	f := newFixture(t)
	mustItem(t, f.s, "FAKE one", "FAKE-VALUE")
	if _, err := f.s.ExportEntryFragment(KindGroup, "no-such-id"); err == nil {
		t.Fatalf("unknown group id must error")
	}
	if _, err := f.s.ExportEntryFragment(KindItem, "no-such-id"); err == nil {
		t.Fatalf("unknown item id must error")
	}
}

func TestFragmentRoundTripEmptyVault(t *testing.T) {
	src, group, _, _ := fragFixture(t)
	target, err := src.s.ExportEntryFragment(KindGroup, group.ID)
	if err != nil {
		t.Fatalf("export: %v", err)
	}

	// A fresh, empty vault in a different directory — another machine.
	dir2 := t.TempDir()
	dst, err := New(dir2, "1.0.0")
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	summary, err := dst.ImportBackup("merge", target.Body)
	if err != nil {
		t.Fatalf("ImportBackup(fragment): %v", err)
	}
	if summary.Added == 0 {
		t.Fatalf("expected additions, got %+v", summary)
	}
	g := dst.State().Data.Groups
	if len(g) != 1 || g[0].ID != group.ID {
		t.Fatalf("group not restored: %+v", g)
	}
	// Membership order identical.
	srcGroup := src.s.State().Data.Groups[0]
	if strings.Join(g[0].ItemIDs, ",") != strings.Join(srcGroup.ItemIDs, ",") {
		t.Fatalf("membership order changed on import")
	}
	// Note/tags/pinned survive.
	var restored *Item
	for i := range dst.State().Data.Items {
		if dst.State().Data.Items[i].ID == srcGroup.ItemIDs[0] {
			restored = &dst.State().Data.Items[i]
		}
	}
	if restored == nil {
		t.Fatalf("member item not restored")
	}
	if restored.Note == "" || len(restored.Tags) != 2 || !restored.Pinned || !restored.IsSecret {
		t.Fatalf("metadata lost on round-trip: %+v", restored)
	}
	if restored.UseCount == 0 || restored.LastUsedAt == nil {
		t.Fatalf("useCount/lastUsedAt lost on round-trip")
	}
}

func TestFragmentMergeNewerLocalWins(t *testing.T) {
	src, group, _, _ := fragFixture(t)
	target, err := src.s.ExportEntryFragment(KindGroup, group.ID)
	if err != nil {
		t.Fatalf("export: %v", err)
	}

	// Destination has the same ids but NEWER local data.
	dir2 := t.TempDir()
	dst, err := New(dir2, "1.0.0")
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if _, err := dst.ImportBackup("merge", target.Body); err != nil {
		t.Fatalf("first import: %v", err)
	}
	localName := "FAKE local newer name"
	memberID := dst.State().Data.Groups[0].ItemIDs[0]
	if err := dst.UpdateItem(memberID, ItemPatch{Name: strp(localName)}); err != nil {
		t.Fatalf("UpdateItem: %v", err)
	}

	// Re-export from the (unchanged) source → older rows; local must win.
	summary, err := dst.ImportBackup("merge", target.Body)
	if err != nil {
		t.Fatalf("re-import: %v", err)
	}
	for _, it := range dst.State().Data.Items {
		if it.ID == memberID && it.Name != localName {
			t.Fatalf("newer local item was downgraded by an older fragment")
		}
	}
	if summary.Updated != 0 {
		t.Fatalf("older fragment must not update newer local rows, got %+v", summary)
	}
}

func TestFragmentMergeOlderLocalWins(t *testing.T) {
	src, group, _, _ := fragFixture(t)
	// First import seeds the destination with the fragment's rows.
	dir2 := t.TempDir()
	dst, err := New(dir2, "1.0.0")
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	target, err := src.s.ExportEntryFragment(KindGroup, group.ID)
	if err != nil {
		t.Fatalf("export: %v", err)
	}
	if _, err := dst.ImportBackup("merge", target.Body); err != nil {
		t.Fatalf("seed import: %v", err)
	}

	// The source moves on: edit an item so its updatedAt is strictly newer
	// (the fixture clock is frozen — advancing it bumps every later stamp).
	src.advance(time.Hour)
	memberID := src.s.State().Data.Groups[0].ItemIDs[1]
	newName := "FAKE renamed upstream"
	if err := src.s.UpdateItem(memberID, ItemPatch{Name: strp(newName)}); err != nil {
		t.Fatalf("UpdateItem: %v", err)
	}
	target2, err := src.s.ExportEntryFragment(KindGroup, group.ID)
	if err != nil {
		t.Fatalf("re-export: %v", err)
	}

	summary, err := dst.ImportBackup("merge", target2.Body)
	if err != nil {
		t.Fatalf("re-import: %v", err)
	}
	if summary.Updated == 0 {
		t.Fatalf("newer fragment rows must update older local rows, got %+v", summary)
	}
	found := false
	for _, it := range dst.State().Data.Items {
		if it.ID == memberID && it.Name == newName {
			found = true
		}
	}
	if !found {
		t.Fatalf("value from newer fragment not applied")
	}
}

func TestFragmentReimportSkips(t *testing.T) {
	src, group, _, _ := fragFixture(t)
	target, err := src.s.ExportEntryFragment(KindGroup, group.ID)
	if err != nil {
		t.Fatalf("export: %v", err)
	}
	frag := exportFragment(t, src.s, KindGroup, group.ID)
	dir2 := t.TempDir()
	dst, err := New(dir2, "1.0.0")
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if _, err := dst.ImportBackup("merge", target.Body); err != nil {
		t.Fatalf("import 1: %v", err)
	}
	summary, err := dst.ImportBackup("merge", target.Body)
	if err != nil {
		t.Fatalf("import 2: %v", err)
	}
	n := len(frag.Items) + len(frag.Groups)
	if summary.Added != 0 || summary.Updated != 0 || summary.Skipped != n {
		t.Fatalf("second import of the same fragment = {0 added, 0 updated, %d skipped}, got %+v", n, summary)
	}
}

func TestFragmentPreviewDistinguishes(t *testing.T) {
	src, group, _, _ := fragFixture(t)
	target, err := src.s.ExportEntryFragment(KindGroup, group.ID)
	if err != nil {
		t.Fatalf("export: %v", err)
	}

	// Fragment preview: valid + scope set.
	fragPreview := src.s.ImportBackupPreview(target.Body)
	if !fragPreview.Valid || fragPreview.Fragment == nil || fragPreview.Fragment.Type != "group" {
		t.Fatalf("fragment preview should be valid with a scope, got %+v", fragPreview)
	}

	// Full backup preview: valid, no fragment scope.
	full, err := src.s.ExportBackupString()
	if err != nil {
		t.Fatalf("ExportBackupString: %v", err)
	}
	fullPreview := src.s.ImportBackupPreview(full)
	if !fullPreview.Valid || fullPreview.Fragment != nil {
		t.Fatalf("full backup preview must not claim a fragment scope: %+v", fullPreview)
	}

	// Garbage: invalid.
	garbage := src.s.ImportBackupPreview("not json at all")
	if garbage.Valid || garbage.Fragment != nil {
		t.Fatalf("garbage must be invalid, got %+v", garbage)
	}
}

func TestFullBackupStillImports(t *testing.T) {
	src, group, items, _ := fragFixture(t)
	full, err := src.s.ExportBackupString()
	if err != nil {
		t.Fatalf("ExportBackupString: %v", err)
	}

	// Replace into a fresh store.
	dir2 := t.TempDir()
	dst, err := New(dir2, "1.0.0")
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if _, err := dst.ImportBackup("replace", full); err != nil {
		t.Fatalf("replace import: %v", err)
	}
	if len(dst.State().Data.Items) != len(items) || len(dst.State().Data.Groups) != 1 {
		t.Fatalf("replace lost rows: %d items, %d groups", len(dst.State().Data.Items), len(dst.State().Data.Groups))
	}

	// Merge into a store that already has an overlapping id.
	dir3 := t.TempDir()
	dst3, err := New(dir3, "1.0.0")
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if _, err := dst3.ImportBackup("merge", full); err != nil {
		t.Fatalf("merge import: %v", err)
	}
	if dst3.State().Data.Groups[0].ID != group.ID {
		t.Fatalf("merge lost the group id")
	}
}

func TestFragmentRejectsFutureVersion(t *testing.T) {
	src, group, _, _ := fragFixture(t)
	target, err := src.s.ExportEntryFragment(KindGroup, group.ID)
	if err != nil {
		t.Fatalf("export: %v", err)
	}
	var raw map[string]any
	if err := json.Unmarshal([]byte(target.Body), &raw); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	raw["fragmentVersion"] = CurrentFragmentVersion + 1
	bad, _ := json.Marshal(raw)

	preview := src.s.ImportBackupPreview(string(bad))
	if preview.Valid {
		t.Fatalf("future fragment version must be rejected in preview")
	}
	if !strings.Contains(preview.Error, "newer version") {
		t.Fatalf("wrong error: %q", preview.Error)
	}
	if _, err := src.s.ImportBackup("merge", string(bad)); err == nil {
		t.Fatalf("future fragment version must be rejected on import")
	}
	// Nothing changed: the group is still there exactly once.
	count := 0
	for _, g := range src.s.State().Data.Groups {
		if g.ID == group.ID {
			count++
		}
	}
	if count != 1 {
		t.Fatalf("store must be untouched, group count = %d", count)
	}
}

func TestFragmentImportTakesPreImportBackup(t *testing.T) {
	src, group, _, _ := fragFixture(t)
	target, err := src.s.ExportEntryFragment(KindGroup, group.ID)
	if err != nil {
		t.Fatalf("export: %v", err)
	}

	dir2 := t.TempDir()
	dst, err := New(dir2, "1.0.0")
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	// Make the destination non-empty so the pre-import backup has content.
	mustItem(t, dst, "FAKE local item", "FAKE-LOCAL-1")
	before := len(dst.ListBackups())

	if _, err := dst.ImportBackup("merge", target.Body); err != nil {
		t.Fatalf("import: %v", err)
	}

	// The newest backup's kind must be pre-import — proven by the index.
	indexRaw, err := os.ReadFile(filepath.Join(dir2, "backups", "index.json"))
	if err != nil {
		t.Fatalf("read index: %v", err)
	}
	var index map[string]string
	if err := json.Unmarshal(indexRaw, &index); err != nil {
		t.Fatalf("parse index: %v", err)
	}
	backups := dst.ListBackups()
	if len(backups) != before+1 {
		t.Fatalf("import must add exactly one backup, before=%d after=%d", before, len(backups))
	}
	newest := backups[len(backups)-1].Name
	if index[newest] != string(kindPreImport) {
		t.Fatalf("newest backup kind = %q, want pre-import", index[newest])
	}
}
