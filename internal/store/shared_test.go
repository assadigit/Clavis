/**
 * CLAVIS — intelligent shared-credential detection tests (v1.8.0,
 * DECISIONS.md §48). Fake values only. Failure messages carry names and
 * counts — never values.
 */
package store

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

/* ------------------- detection (the pure scan) ------------------- */

// The reported shape: one value pasted into several groups → one cluster,
// oldest copy proposed as the survivor, members oldest-first, group names
// sorted, no values in the payload.
func TestDetectSharedDuplicatesAcrossGroups(t *testing.T) {
	f := newFixture(t)
	x := mustItem(t, f.s, "GitHub token", "ghp_secret_value") // oldest → canonical
	f.advance(time.Minute)
	y := mustItem(t, f.s, "GH_PAT", "ghp_secret_value")
	f.advance(time.Minute)
	z := mustItem(t, f.s, "token for repo C", "ghp_secret_value")
	mustGroup(t, f.s, "Repo A", x.ID)
	mustGroup(t, f.s, "Repo B", y.ID)
	mustGroup(t, f.s, "Repo C", z.ID)
	// The same value ALSO exists twice inside ONE group: same secret, so
	// those copies join the same cluster too (one value = one cluster; a
	// merge collapses their two group references into one).
	d1 := mustItem(t, f.s, "solo copy 1", "ghp_secret_value")
	d2 := mustItem(t, f.s, "solo copy 2", "ghp_secret_value")
	mustGroup(t, f.s, "One group only", d1.ID, d2.ID)
	// A decoy: different value → never clusters.
	mustItem(t, f.s, "other token", "a_different_value")
	// A decoy: a different value twice inside ONE group → never shareable.
	s1 := mustItem(t, f.s, "solo other 1", "another_value")
	s2 := mustItem(t, f.s, "solo other 2", "another_value")
	mustGroup(t, f.s, "Second one group", s1.ID, s2.ID)

	clusters := DetectSharedDuplicates(f.s.State().Data)
	if len(clusters) != 1 {
		t.Fatalf("detected %d clusters, want 1 (same-group and differing-value decoys never count)", len(clusters))
	}
	c := clusters[0]
	if c.ItemID != x.ID {
		t.Fatalf("canonical is %s, want the oldest copy %s", c.ItemID, x.ID)
	}
	if c.Copies != 5 {
		t.Fatalf("copies = %d, want 5 (every copy of the value joins, incl. the same-group pair)", c.Copies)
	}
	if len(c.Members) != 5 || c.Members[0].ItemID != x.ID {
		t.Fatal("members must list all 5 copies oldest-first")
	}
	if strings.Join(c.GroupNames, ",") != "One group only,Repo A,Repo B,Repo C" {
		t.Fatalf("groupNames = %v, want the four sorted group names", c.GroupNames)
	}
	if len(c.Members[1].GroupNames) != 1 || c.Members[1].GroupNames[0] != "Repo B" {
		t.Fatalf("member 1 groups = %v, want [Repo B]", c.Members[1].GroupNames)
	}
	if c.ValueLast4 != "" {
		t.Fatal("the store scan must not fill valueLast4 — the service owns the §5.2 hint")
	}
}

// The user's clarified criterion, pinned: the cluster key is the VALUE being
// IDENTICAL — a 20-character value pasted once into each of 5 groups is ONE
// cluster of 5 copies spanning 5 groups, and a value that differs by a single
// character's case is a DIFFERENT value that never joins ("The Value must be
// identical, like a 20 character value that is repeated among 5 groups").
func TestDetectSharedDuplicatesIdenticalValueFiveGroups(t *testing.T) {
	f := newFixture(t)
	const v = "ghp_20char_abc123XYZ" // exactly 20 characters, token-shaped
	if len(v) != 20 {
		t.Fatalf("the test value must be 20 characters, got %d", len(v))
	}
	first := mustItem(t, f.s, "GitHub token", v) // oldest → canonical
	f.advance(time.Minute)
	second := mustItem(t, f.s, "GH_PAT", v)
	f.advance(time.Minute)
	third := mustItem(t, f.s, "ci token", v)
	f.advance(time.Minute)
	fourth := mustItem(t, f.s, "deploy token", v)
	f.advance(time.Minute)
	fifth := mustItem(t, f.s, "backup token", v)
	mustGroup(t, f.s, "Project A", first.ID)
	mustGroup(t, f.s, "Project B", second.ID)
	mustGroup(t, f.s, "Project C", third.ID)
	mustGroup(t, f.s, "Project D", fourth.ID)
	mustGroup(t, f.s, "Project E", fifth.ID)

	// The near miss: same shape, first character's case flipped — NOT an
	// identical value. One case-insensitive comparison anywhere in the scan
	// would absorb it as a 6th copy; byte-exact matching must not.
	flipped := "G" + v[1:]
	if flipped == v {
		t.Fatal("the near-miss value must differ from the real one")
	}
	nearMiss := mustItem(t, f.s, "near-miss token", flipped)
	mustGroup(t, f.s, "Project F", nearMiss.ID)

	clusters := DetectSharedDuplicates(f.s.State().Data)
	if len(clusters) != 1 {
		t.Fatalf("detected %d clusters, want exactly 1 — the identical 20-character value; the case-flipped near miss is a different value", len(clusters))
	}
	c := clusters[0]
	if c.Copies != 5 || len(c.Members) != 5 {
		t.Fatalf("copies = %d, members = %d — want 5/5 (the near miss must NOT join)", c.Copies, len(c.Members))
	}
	if c.ItemID != first.ID {
		t.Fatalf("canonical = %s, want the oldest copy %s", c.ItemID, first.ID)
	}
	if want := "Project A,Project B,Project C,Project D,Project E"; strings.Join(c.GroupNames, ",") != want {
		t.Fatalf("groupNames = %v, want the five projects only", c.GroupNames)
	}
	for _, m := range c.Members {
		if m.ItemID == nearMiss.ID {
			t.Fatal("a value differing by one character's case is not identical — it must never join the cluster")
		}
	}
}

// An already-shared copy wins the canonical rank even when younger, so a
// merge keeps the Shared-view identity the user already has.
func TestDetectSharedDuplicatesPrefersSharedCanonical(t *testing.T) {
	f := newFixture(t)
	older := mustItem(t, f.s, "old private copy", "pw_same")
	f.advance(time.Minute)
	younger, err := f.s.CreateItem(NewItem{Name: "shared one", Value: "pw_same", Shared: true})
	if err != nil {
		t.Fatalf("CreateItem: %v", err)
	}
	mustGroup(t, f.s, "Group A", older.ID)
	mustGroup(t, f.s, "Group B", younger.ID)

	clusters := DetectSharedDuplicates(f.s.State().Data)
	if len(clusters) != 1 || clusters[0].ItemID != younger.ID {
		t.Fatal("the already-shared copy must be the proposed canonical")
	}
}

// Eligibility needs ≥2 distinct GROUPS: duplicates inside one group are not
// shareable, and a standalone twin of one group copy does not qualify
// either — but standalone + two groups does (all copies merge).
func TestDetectSharedDuplicatesNeedsTwoGroups(t *testing.T) {
	f := newFixture(t)
	a := mustItem(t, f.s, "copy A", "v1")
	b := mustItem(t, f.s, "copy B", "v1")
	mustGroup(t, f.s, "Only group", a.ID, b.ID)
	if clusters := DetectSharedDuplicates(f.s.State().Data); len(clusters) != 0 {
		t.Fatalf("same-group duplicates must not be reported, got %d", len(clusters))
	}

	// A standalone twin (in NO group) of one group copy: still one group.
	mustItem(t, f.s, "standalone twin", "v1")
	if clusters := DetectSharedDuplicates(f.s.State().Data); len(clusters) != 0 {
		t.Fatalf("a standalone twin spans one group — not shareable, got %d", len(clusters))
	}

	// Standalone + two groups on a fresh value: eligible — every copy joins
	// (the standalone one included; it merges like any other duplicate).
	mustItem(t, f.s, "standalone of v2", "v2")
	d := mustItem(t, f.s, "group D copy", "v2")
	e := mustItem(t, f.s, "group E copy", "v2")
	mustGroup(t, f.s, "Group D", d.ID)
	mustGroup(t, f.s, "Group E", e.ID)
	clusters := DetectSharedDuplicates(f.s.State().Data)
	if len(clusters) != 1 {
		t.Fatalf("standalone + two groups must be one cluster, got %d", len(clusters))
	}
	if clusters[0].Copies != 3 {
		t.Fatalf("the v2 cluster must hold all 3 copies, got %d", clusters[0].Copies)
	}
}

// Document groups are opaque text (§40) and never count toward the span; a
// trashed twin is invisible to the scan; empty values never cluster.
func TestDetectSharedDuplicatesIgnoresDocGroupsTrashAndEmpty(t *testing.T) {
	f := newFixture(t)
	a := mustItem(t, f.s, "copy A", "v1")
	if _, err := f.s.CreateGroupFromDoc(NewGroup{Name: "Doc group"}, "GITHUB_TOKEN=v1\n"); err != nil {
		t.Fatalf("CreateGroupFromDoc: %v", err)
	}
	mustGroup(t, f.s, "Items group", a.ID)
	if clusters := DetectSharedDuplicates(f.s.State().Data); len(clusters) != 0 {
		t.Fatalf("one items group + a document group must not cluster, got %d", len(clusters))
	}

	// A trashed twin is invisible.
	trashed := mustItem(t, f.s, "trashed twin", "v1")
	if _, err := f.s.DeleteEntry(KindItem, trashed.ID); err != nil {
		t.Fatalf("DeleteEntry: %v", err)
	}
	if clusters := DetectSharedDuplicates(f.s.State().Data); len(clusters) != 0 {
		t.Fatalf("trashed copies must not join a cluster, got %d", len(clusters))
	}

	// Empty values never cluster.
	e1 := mustItem(t, f.s, "empty 1", "")
	e2 := mustItem(t, f.s, "empty 2", "")
	mustGroup(t, f.s, "Empties A", e1.ID)
	mustGroup(t, f.s, "Empties B", e2.ID)
	if clusters := DetectSharedDuplicates(f.s.State().Data); len(clusters) != 0 {
		t.Fatalf("empty values must never cluster, got %d", len(clusters))
	}
}

// The user's report, verbatim (v1.11.1, DECISIONS.md §52): "currently same
// github token has been repeated across literally all groups items, but
// system didn't find it." The copies were byte-DIFFERENT: the paste parser
// trims values before storing, but the item editor stores verbatim — so
// copies created by typing/pasting into the editor carry clipboard padding
// forever, and pre-v1.6.0 pastes predate the tolerant parser's trim. The
// byte-exact scan filed every copy under its own bucket and reported
// all-clear. The comparison now trims surrounding whitespace (one
// sharedValueKey rule): one token across all groups → one cluster, no
// matter what padding each copy wandered in with.
func TestDetectSharedDuplicatesToleratesSurroundingWhitespace(t *testing.T) {
	f := newFixture(t)
	// The user's shape: ONE GitHub token, one copy per group, ALL groups.
	clean := mustItem(t, f.s, "GitHub token", "ghp_padded_2026") // oldest → canonical
	f.advance(time.Minute)
	padLeft := mustItem(t, f.s, "GH_PAT", " ghp_padded_2026")
	f.advance(time.Minute)
	padRight := mustItem(t, f.s, "ci token", "ghp_padded_2026 ")
	f.advance(time.Minute)
	padBoth := mustItem(t, f.s, "deploy token", "  ghp_padded_2026  ")
	f.advance(time.Minute)
	padTabs := mustItem(t, f.s, "backup token", "\tghp_padded_2026\r\n")
	mustGroup(t, f.s, "Project A", clean.ID)
	mustGroup(t, f.s, "Project B", padLeft.ID)
	mustGroup(t, f.s, "Project C", padRight.ID)
	mustGroup(t, f.s, "Project D", padBoth.ID)
	mustGroup(t, f.s, "Project E", padTabs.ID)
	// Boundary decoy that must NOT join: quoting is content, not padding —
	// a password may legitimately start and end with a quote.
	quoted := mustItem(t, f.s, "quoted copy", `"ghp_padded_2026"`)
	mustGroup(t, f.s, "Project F", quoted.ID)
	// Whitespace-only values are EMPTY for comparison — never cluster,
	// even spanning two groups (the only reason they can't: the empty-key skip).
	spacer1 := mustItem(t, f.s, "blank 1", "   ")
	spacer2 := mustItem(t, f.s, "blank 2", "\t ")
	mustGroup(t, f.s, "Project G", spacer1.ID)
	mustGroup(t, f.s, "Project H", spacer2.ID)

	clusters := DetectSharedDuplicates(f.s.State().Data)
	if len(clusters) != 1 {
		t.Fatalf("detected %d clusters, want 1 — the padded copies of ONE token must join one cluster (the user's report)", len(clusters))
	}
	c := clusters[0]
	if c.Copies != 5 || len(c.Members) != 5 {
		t.Fatalf("copies = %d, members = %d — want 5/5: every padded copy joins its clean sibling", c.Copies, len(c.Members))
	}
	if c.ItemID != clean.ID {
		t.Fatalf("canonical = %s, want the oldest copy %s", c.ItemID, clean.ID)
	}
	if want := "Project A,Project B,Project C,Project D,Project E"; strings.Join(c.GroupNames, ",") != want {
		t.Fatalf("groupNames = %v, want the five projects (the quoted copy and the blanks never join)", c.GroupNames)
	}
	for _, m := range c.Members {
		if m.ItemID == quoted.ID {
			t.Fatal("a quoted value is a different value — quotes are content, not padding")
		}
		if m.ItemID == spacer1.ID || m.ItemID == spacer2.ID {
			t.Fatal("a whitespace-only value is empty — it must never cluster")
		}
	}
}

// Biggest cluster first, then name — the most impactful suggestion on top.
func TestDetectSharedDuplicatesOrdering(t *testing.T) {
	f := newFixture(t)
	// Cluster "Zed": 3 copies of one value.
	z1 := mustItem(t, f.s, "Zed token", "vz")
	f.advance(time.Minute)
	z2 := mustItem(t, f.s, "Zed twin", "vz")
	f.advance(time.Minute)
	z3 := mustItem(t, f.s, "Zed third", "vz")
	mustGroup(t, f.s, "ZG1", z1.ID)
	mustGroup(t, f.s, "ZG2", z2.ID)
	mustGroup(t, f.s, "ZG3", z3.ID)
	// Cluster "Alpha": 2 copies of another value (advance the clock so the
	// canonical pick never depends on the uuid tie-break).
	a1 := mustItem(t, f.s, "Alpha token", "va")
	f.advance(time.Minute)
	a2 := mustItem(t, f.s, "Alpha twin", "va")
	mustGroup(t, f.s, "AG1", a1.ID)
	mustGroup(t, f.s, "AG2", a2.ID)

	clusters := DetectSharedDuplicates(f.s.State().Data)
	if len(clusters) != 2 {
		t.Fatalf("want 2 clusters, got %d", len(clusters))
	}
	if clusters[0].Name != "Zed token" || clusters[0].Copies != 3 {
		t.Fatalf("the 3-copy cluster must rank first, got %s (%d copies)", clusters[0].Name, clusters[0].Copies)
	}
	if clusters[1].Name != "Alpha token" || clusters[1].Copies != 2 {
		t.Fatalf("the 2-copy cluster must rank second, got %s (%d copies)", clusters[1].Name, clusters[1].Copies)
	}
}

/* ------------------- merge (the consolidation) ------------------- */

// The full happy path: three copies across three groups merge into ONE
// shared credential; groups are re-pointed in place; duplicates land in the
// Trash with tombstones; pinned survives; everything persists.
func TestMergeSharedDuplicatesHappyPath(t *testing.T) {
	f := newFixture(t)
	x := mustItem(t, f.s, "GitHub token", "ghp_shared_value") // oldest → canonical
	f.advance(time.Minute)
	y := mustItem(t, f.s, "GH_PAT", "ghp_shared_value")
	f.advance(time.Minute)
	z := mustItem(t, f.s, "repo C token", "ghp_shared_value")
	// z carries history the merge must keep alive: pinned.
	if err := f.s.UpdateItem(z.ID, ItemPatch{Pinned: boolp(true)}); err != nil {
		t.Fatalf("pin z: %v", err)
	}
	mustGroup(t, f.s, "Repo A", x.ID)
	mustGroup(t, f.s, "Repo B", y.ID)
	mustGroup(t, f.s, "Repo C", z.ID)

	got, err := f.s.MergeSharedDuplicates([]string{x.ID, y.ID, z.ID})
	if err != nil {
		t.Fatalf("MergeSharedDuplicates: %v", err)
	}
	if got.ID != x.ID || !got.Shared {
		t.Fatal("canonical must be the oldest copy, now shared")
	}

	st := f.s.State()
	for _, g := range st.Data.Groups {
		if g.DeletedAt != nil {
			continue
		}
		if len(g.ItemIDs) != 1 || g.ItemIDs[0] != x.ID {
			t.Fatalf("group %s must reference only the canonical, got %v", g.Name, g.ItemIDs)
		}
	}
	for _, id := range []string{y.ID, z.ID} {
		if !isDeleted(st, KindItem, id) {
			t.Fatalf("absorbed copy %s must be in the Trash", id)
		}
	}
	tombs := readDeletionsFile(t, f.dir)
	if tombs[y.ID] == "" || tombs[z.ID] == "" {
		t.Fatal("absorbed copies must carry tombstones (§46): a stale backup can never resurrect them as live duplicates")
	}
	if tombs[x.ID] != "" {
		t.Fatal("the canonical survivor must NOT be tombstoned")
	}
	canonical := f.s.findItem(x.ID)
	if canonical == nil || !canonical.Pinned {
		t.Fatal("pinned survives the merge when any copy had it")
	}

	// Persistence: reopen and verify the merged world survives.
	f.s.Close()
	s2, err := New(f.dir, "1.0.0")
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	defer s2.Close()
	st2 := s2.State()
	if len(st2.Data.Groups) != 3 {
		t.Fatalf("reopen: %d groups, want 3", len(st2.Data.Groups))
	}
	live := 0
	for _, it := range st2.Data.Items {
		if it.DeletedAt == nil && it.Value == "ghp_shared_value" {
			live++
		}
	}
	if live != 1 {
		t.Fatalf("reopen: %d live copies of the value, want exactly 1 (the shared canonical)", live)
	}
}

// A group holding TWO copies of the value collapses to one reference at the
// first copy's slot; unrelated neighbors keep their positions.
func TestMergeSharedDuplicatesGroupWithTwoCopies(t *testing.T) {
	f := newFixture(t)
	a := mustItem(t, f.s, "copy A", "vv") // older → canonical
	f.advance(time.Minute)
	b := mustItem(t, f.s, "copy B", "vv")
	other := mustItem(t, f.s, "unrelated", "other_value")
	// Group order: [b, other, a] — b's slot (the first cluster member's
	// slot) becomes the canonical reference.
	if _, err := f.s.CreateGroup(NewGroup{Name: "Mixed", ItemIDs: []string{b.ID, other.ID, a.ID}}); err != nil {
		t.Fatalf("CreateGroup: %v", err)
	}
	if _, err := f.s.CreateGroup(NewGroup{Name: "Second", ItemIDs: []string{b.ID}}); err != nil {
		t.Fatalf("CreateGroup 2: %v", err)
	}
	if _, err := f.s.MergeSharedDuplicates([]string{a.ID, b.ID}); err != nil {
		t.Fatalf("merge: %v", err)
	}
	st := f.s.State()
	for _, g := range st.Data.Groups {
		if g.Name != "Mixed" {
			continue
		}
		if len(g.ItemIDs) != 2 || g.ItemIDs[0] != a.ID || g.ItemIDs[1] != other.ID {
			t.Fatalf("Mixed must become [canonical, unrelated] in place, got %v", g.ItemIDs)
		}
	}
}

// The merge across PADDED copies: the re-validation trims (a padding-only
// edit between scan and merge never makes the confirmation stale), and the
// canonical keeps its stored value BYTE-EXACT — the merge never rewrites a
// value (§5.2). If the survivor's copy carries padding, it stays as stored;
// the user edits it afterwards like any shared credential.
func TestMergeSharedDuplicatesPaddedValues(t *testing.T) {
	f := newFixture(t)
	padded := mustItem(t, f.s, "GitHub token", " ghp_padded_merge ") // oldest → canonical, padding and all
	f.advance(time.Minute)
	clean := mustItem(t, f.s, "GH_PAT", "ghp_padded_merge")
	f.advance(time.Minute)
	other := mustItem(t, f.s, "ci token", "ghp_padded_merge\t")
	mustGroup(t, f.s, "Repo A", padded.ID)
	mustGroup(t, f.s, "Repo B", clean.ID)
	mustGroup(t, f.s, "Repo C", other.ID)

	// A padding-only edit after the scan: still the same credential — the
	// merge must go through (the byte-exact version refused this).
	if err := f.s.UpdateItem(other.ID, ItemPatch{Value: strp(" ghp_padded_merge ")}); err != nil {
		t.Fatalf("pad-edit other: %v", err)
	}
	got, err := f.s.MergeSharedDuplicates([]string{padded.ID, clean.ID, other.ID})
	if err != nil {
		t.Fatalf("MergeSharedDuplicates across padded copies: %v", err)
	}
	if got.ID != padded.ID || !got.Shared {
		t.Fatal("the oldest padded copy must survive as the shared canonical")
	}
	after := f.s.findItem(padded.ID)
	if after == nil || after.Value != " ghp_padded_merge " {
		t.Fatalf("the canonical's stored value must stay byte-exact (no silent trim), got %q", after.Value)
	}
	st := f.s.State()
	for _, g := range st.Data.Groups {
		if g.DeletedAt == nil && (len(g.ItemIDs) != 1 || g.ItemIDs[0] != padded.ID) {
			t.Fatalf("group %s must reference only the canonical, got %v", g.Name, g.ItemIDs)
		}
	}
	tombs := readDeletionsFile(t, f.dir)
	if tombs[clean.ID] == "" || tombs[other.ID] == "" {
		t.Fatal("absorbed copies must carry tombstones (§46): a stale backup can never resurrect them as live duplicates")
	}
	if tombs[padded.ID] != "" {
		t.Fatal("the canonical survivor must NOT be tombstoned")
	}
	// The merged world must not re-cluster: one shared copy, nothing to find.
	if clusters := DetectSharedDuplicates(f.s.State().Data); len(clusters) != 0 {
		t.Fatalf("after the merge the scan must find nothing, got %d clusters", len(clusters))
	}
}

// Apply-time re-validation: a confirmation that went stale is REFUSED —
// never silently resolved — and the vault is left untouched.
func TestMergeSharedDuplicatesRefusesStaleConfirmations(t *testing.T) {
	f := newFixture(t)
	a := mustItem(t, f.s, "copy A", "v1")
	f.advance(time.Minute)
	b := mustItem(t, f.s, "copy B", "v1")
	mustGroup(t, f.s, "Group A", a.ID)
	mustGroup(t, f.s, "Group B", b.ID)

	// Fewer than two ids.
	if _, err := f.s.MergeSharedDuplicates([]string{a.ID}); err == nil {
		t.Fatal("merging one item must fail")
	}
	// Unknown id.
	if _, err := f.s.MergeSharedDuplicates([]string{a.ID, "nope"}); err == nil {
		t.Fatal("unknown member must fail")
	}
	// Values diverged after the scan (the user rotated one copy).
	if err := f.s.UpdateItem(b.ID, ItemPatch{Value: strp("rotated_value")}); err != nil {
		t.Fatalf("rotate b: %v", err)
	}
	if _, err := f.s.MergeSharedDuplicates([]string{a.ID, b.ID}); err == nil {
		t.Fatal("a merge whose values no longer match must fail loudly")
	}
	// Nothing changed: both copies still live, groups untouched.
	st := f.s.State()
	for _, it := range st.Data.Items {
		if it.DeletedAt != nil {
			t.Fatal("refused merges must not touch the vault")
		}
	}
	// A trashed member is equally refused.
	if _, err := f.s.DeleteEntry(KindItem, b.ID); err != nil {
		t.Fatalf("trash b: %v", err)
	}
	if _, err := f.s.MergeSharedDuplicates([]string{a.ID, b.ID}); err == nil {
		t.Fatal("a merge over a trashed member must fail")
	}
}

// The §46 promise extended to merges: after a merge, a stale rewrite of the
// data file (an old copy of the app, a restored old file) can never bring
// the ABSORBED copies back LIVE — they land in the Trash with the banner,
// and the canonical stays the single shared reference.
func TestMergeSharedDuplicatesFinalAgainstStaleRewrite(t *testing.T) {
	f := newFixture(t)
	a := mustItem(t, f.s, "copy A", "v1")
	f.advance(time.Minute)
	b := mustItem(t, f.s, "copy B", "v1")
	mustGroup(t, f.s, "Group A", a.ID)
	mustGroup(t, f.s, "Group B", b.ID)
	if _, err := f.s.MergeSharedDuplicates([]string{a.ID, b.ID}); err != nil {
		t.Fatalf("merge: %v", err)
	}

	// The reported mechanism: the file gets rewritten with the absorbed
	// copy LIVE again (a stale copy of the app holding the old world).
	resurrectEntry(t, f.dir, b.ID)
	f.s.Close()
	s2, err := New(f.dir, "1.0.0")
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	defer s2.Close()
	st := s2.State()
	if !isDeleted(st, KindItem, b.ID) {
		t.Fatal("an absorbed copy that reappeared in the file must be moved back to the Trash (merge tombstones)")
	}
	if isDeleted(st, KindItem, a.ID) {
		t.Fatal("the canonical survivor must stay live")
	}
	if st.RecoveredNotice == nil {
		t.Fatal("the re-applied deletions must be explained by a banner")
	}
}

// Read-only stores (a newer-version data file) refuse the merge and leave
// everything untouched.
func TestMergeSharedDuplicatesReadOnlyRefused(t *testing.T) {
	f := newFixture(t)
	a := mustItem(t, f.s, "copy A", "v1")
	b := mustItem(t, f.s, "copy B", "v1")
	mustGroup(t, f.s, "Group A", a.ID)
	mustGroup(t, f.s, "Group B", b.ID)
	before := readDataFile(t, f.dir)
	var v map[string]any
	if err := json.Unmarshal([]byte(before), &v); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	v["schemaVersion"] = float64(99)
	b2, _ := json.Marshal(v)
	writeDataFile(t, f.dir, string(b2))
	f.s.Close()
	s2, err := New(f.dir, "1.0.0")
	if err != nil {
		t.Fatalf("reopen read-only: %v", err)
	}
	defer s2.Close()
	if _, err := s2.MergeSharedDuplicates([]string{a.ID, b.ID}); err == nil {
		t.Fatal("read-only stores must refuse merges")
	}
	if after := readDataFile(t, f.dir); after != string(b2) {
		t.Fatal("a refused merge must not touch the data file")
	}
}
