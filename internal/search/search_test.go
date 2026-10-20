/**
 * CLAVIS — search tests (SPEC §10): matching, operators, fuzzy, ranking,
 * empty-query ordering. Secret values are never part of the index.
 */
package search

import (
	"testing"
	"time"

	"clavis/internal/store"
)

func vault(entries ...func(*store.VaultData)) store.VaultData {
	v := store.StarterVault("test", store.NewUUID, time.Now())
	for _, fn := range entries {
		fn(&v)
	}
	return v
}

func item(v *store.VaultData, id, name, key, note, catID string, tags []string, pinned bool, use int, last *string) {
	categoryID := (*string)(nil)
	if catID != "" {
		categoryID = &catID
	}
	v.Items = append(v.Items, store.Item{
		ID: id, Name: name, Key: key, Value: "VALUE-" + id, Note: note,
		CategoryID: categoryID, Tags: tags, IsSecret: true, Pinned: pinned,
		UseCount: use, LastUsedAt: last, CreatedAt: "2026-01-01T00:00:00.000Z",
		UpdatedAt: "2026-01-01T00:00:00.000Z",
	})
}

func group(v *store.VaultData, id, name, catID string, tags []string, pinned bool, use int) {
	categoryID := (*string)(nil)
	if catID != "" {
		categoryID = &catID
	}
	v.Groups = append(v.Groups, store.Group{
		ID: id, Name: name, CategoryID: categoryID, Tags: tags, ItemIDs: []string{},
		Pinned: pinned, UseCount: use, CreatedAt: "2026-01-01T00:00:00.000Z",
		UpdatedAt: "2026-01-01T00:00:00.000Z",
	})
}

func ids(entries []Entry) []string {
	out := make([]string, len(entries))
	for i, e := range entries {
		out[i] = e.ID
	}
	return out
}

func TestPlainWordMatching(t *testing.T) {
	v := vault(func(v *store.VaultData) {
		item(v, "a", "GitHub token", "GITHUB_TOKEN", "note text", "", []string{"github"}, false, 0, nil)
		item(v, "b", "Cloudflare token", "CF_TOKEN", "", "", nil, false, 0, nil)
		group(v, "g", "Sedanama credentials", "", []string{"sedanama"}, false, 0)
	})
	e := BuildEntries(v)

	// Name match.
	if got := ids(Search("github", e)); len(got) != 1 || got[0] != "a" {
		t.Errorf("name match: %v", got)
	}
	// Key match.
	if got := ids(Search("cf_token", e)); len(got) != 1 || got[0] != "b" {
		t.Errorf("key match: %v", got)
	}
	// Fuzzy subsequence: "ghtk" → "GitHub token".
	if got := ids(Search("ghtk", e)); len(got) != 1 || got[0] != "a" {
		t.Errorf("fuzzy match: %v", got)
	}
	// Secret VALUES are never matched ("VALUE-a" is the value of a).
	if got := ids(Search("value-a", e)); len(got) != 0 {
		t.Errorf("secret value must not match: %v", got)
	}
}

func TestTagAndCategoryOperators(t *testing.T) {
	v := vault(func(v *store.VaultData) {
		// two categories
		v.Categories = append(v.Categories,
			store.Category{ID: "cat-cred", Name: "Credentials", SortOrder: 0},
			store.Category{ID: "cat-prompts", Name: "Prompts", SortOrder: 1})
		item(v, "a", "Alpha one", "ALPHA", "", "cat-cred", []string{"alpha", "work"}, false, 0, nil)
		item(v, "b", "Alpha two", "", "", "cat-prompts", []string{"alpha"}, false, 0, nil)
		item(v, "c", "Beta", "", "", "cat-prompts", []string{"home"}, false, 0, nil)
	})
	e := BuildEntries(v)

	if got := len(Search("#alpha", e)); got != 2 {
		t.Errorf("#alpha: %d results, want 2", got)
	}
	if got := len(Search("#work", e)); got != 1 {
		t.Errorf("#work: %d results, want 1", got)
	}
	if got := len(Search("@prompts", e)); got != 2 {
		t.Errorf("@prompts: %d results, want 2", got)
	}
	// Combined with AND.
	if got := len(Search("#alpha @prompts", e)); got != 1 {
		t.Errorf("#alpha @prompts: %d results, want 1", got)
	}
}

func TestRanking(t *testing.T) {
	v := vault(func(v *store.VaultData) {
		item(v, "exact", "deploy", "", "", "", nil, false, 0, nil)
		item(v, "prefix", "deploy prod", "", "", "", nil, false, 0, nil)
		item(v, "tagged", "Release notes", "", "", "", []string{"deploy"}, false, 0, nil)
	})
	e := BuildEntries(v)
	got := ids(Search("deploy", e))
	want := []string{"exact", "prefix", "tagged"}
	if len(got) != len(want) {
		t.Fatalf("ranking: got %d results, want %d (%v)", len(got), len(want), got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("ranking[%d] = %q, want %q (all: %v)", i, got[i], want[i], got)
		}
	}
}

func TestEmptyQueryOrdering(t *testing.T) {
	older := "2026-01-01T00:00:00.000Z"
	newer := "2026-06-01T00:00:00.000Z"
	v := vault(func(v *store.VaultData) {
		item(v, "plain", "Plain", "", "", "", nil, false, 3, &older)
		item(v, "used", "Used", "", "", "", nil, false, 10, &older)
		item(v, "pinned", "Pinned", "", "", "", nil, true, 1, &older)
		item(v, "recent", "Recent", "", "", "", nil, false, 3, &newer)
	})
	e := BuildEntries(v)
	got := ids(Search("", e))
	want := []string{"pinned", "used", "recent", "plain"} // pinned > useCount > lastUsedAt
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("empty query order[%d] = %q, want %q (all: %v)", i, got[i], want[i], got)
		}
	}
}

func TestDeletedEntriesExcluded(t *testing.T) {
	deleted := "2026-01-02T00:00:00.000Z"
	v := vault(func(v *store.VaultData) {
		item(v, "live", "Live", "", "", "", nil, false, 0, nil)
		item(v, "dead", "Dead", "", "", "", nil, false, 0, nil)
		v.Items[1].DeletedAt = &deleted
	})
	e := BuildEntries(v)
	if got := ids(Search("dead", e)); len(got) != 0 {
		t.Errorf("deleted entries must not be searchable: %v", got)
	}
}

func TestSpecExampleGhtk(t *testing.T) {
	// §5.1: for example "ghtk" finds "GitHub token".
	v := vault(func(v *store.VaultData) {
		item(v, "x", "GitHub token", "GITHUB_TOKEN", "", "", []string{"github"}, false, 0, nil)
	})
	if got := ids(Search("ghtk", BuildEntries(v))); len(got) != 1 {
		t.Errorf("spec example failed")
	}
}
