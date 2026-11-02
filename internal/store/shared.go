/**
 * CLAVIS — intelligent shared-credential detection (v1.8.0, DECISIONS.md §48).
 *
 * The user's report: every group was pasted in bulk, so the same secret — a
 * GitHub token, one password — exists as SEPARATE private copies in several
 * groups. Rotating it meant hunting down every copy by hand. The v1.6.0
 * shared flag solved this for credentials created shared from the start;
 * this file adds the missing half: DETECT the copies that already exist and
 * consolidate them into one shared credential, referenced by every group.
 *
 * SECURITY: item values never cross to the webview (§5.2) — so the scan runs
 * here, on the raw vault, and its result carries ids, names and group names
 * only. The service layer attaches the masked valueLast4 hint with the same
 * rule the state envelope uses. The merge validates everything AGAIN at
 * apply time (items live, values still identical) — a stale confirmation
 * from before an edit must never silently pick a value.
 *
 * Document groups (§40) are opaque verbatim text and reference no items, so
 * they never take part in detection or merging; their content is re-pasted
 * by the user, by design.
 */
package store

import (
	"errors"
)

// SharedDuplicateMember is one copy of a duplicated value: the item plus the
// live items-mode groups that reference it (names only — never values).
type SharedDuplicateMember struct {
	ItemID     string   `json:"itemId"`
	Name       string   `json:"name"`
	Key        string   `json:"key"`
	GroupNames []string `json:"groupNames"`
}

// SharedDuplicateCluster is one detected duplicate set: K live items holding
// the exact same non-empty value, together referenced by ≥2 distinct live
// groups. ItemID is the copy that would survive a merge (see sharedRankLess).
// ValueLast4 is deliberately NOT set here — the service fills it under the
// §5.2 rule so the masked hint has exactly one implementation.
type SharedDuplicateCluster struct {
	ItemID     string                  `json:"itemId"`
	Name       string                  `json:"name"`
	Key        string                  `json:"key"`
	ValueLast4 string                  `json:"valueLast4,omitempty"`
	Copies     int                     `json:"copies"`
	GroupNames []string                `json:"groupNames"`
	Members    []SharedDuplicateMember `json:"members"`
}

// sharedRankLess reports whether item a beats item b as the canonical
// survivor of a merge: an already-shared item wins first (it keeps its
// Shared-view identity and quick-add chips), then the oldest creation, then
// the smallest id — fully deterministic, so scan and merge always agree.
func sharedRankLess(a, b Item) bool {
	if a.Shared != b.Shared {
		return a.Shared
	}
	if a.CreatedAt != b.CreatedAt {
		return a.CreatedAt < b.CreatedAt // NowISO strings sort chronologically
	}
	return a.ID < b.ID
}

// DetectSharedDuplicates scans the vault for values that exist as two or
// more live items referenced by two or more distinct live items-mode groups
// (the "same token pasted into every project" shape). Pure function: no
// locking, no IO, no values in the output. Clusters return biggest first,
// then by name — the most impactful suggestion on top.
func DetectSharedDuplicates(v VaultData) []SharedDuplicateCluster {
	/* itemId → names of the live items-mode groups referencing it. */
	groupsOf := map[string][]string{}
	for _, g := range v.Groups {
		if g.DeletedAt != nil || g.IsDocumentGroup() {
			continue
		}
		for _, id := range g.ItemIDs {
			if !containsStr(groupsOf[id], g.Name) {
				groupsOf[id] = append(groupsOf[id], g.Name)
			}
		}
	}
	for id := range groupsOf {
		sortStrings(groupsOf[id])
	}

	/* value → live items holding it. Empty values never cluster. */
	byValue := map[string][]Item{}
	for _, it := range v.Items {
		if it.DeletedAt == nil && it.Value != "" {
			byValue[it.Value] = append(byValue[it.Value], it)
		}
	}

	clusters := []SharedDuplicateCluster{}
	for _, members := range byValue {
		if len(members) < 2 {
			continue
		}
		/* Eligibility: the copies must span ≥2 distinct live groups — the
		   user's shape is "the same thing in several groups". Duplicates
		   inside ONE group are not shareable and stay unreported. */
		span := map[string]bool{}
		for _, m := range members {
			for _, name := range groupsOf[m.ID] {
				span[name] = true
			}
		}
		if len(span) < 2 {
			continue
		}
		clusters = append(clusters, buildSharedCluster(members, groupsOf))
	}

	/* Deterministic order: most copies first, then canonical name. */
	for i := 1; i < len(clusters); i++ {
		for j := i; j > 0; j-- {
			a, b := clusters[j], clusters[j-1]
			if a.Copies > b.Copies || (a.Copies == b.Copies && a.Name < b.Name) {
				clusters[j], clusters[j-1] = clusters[j-1], clusters[j]
			} else {
				break
			}
		}
	}
	return clusters
}

// buildSharedCluster shapes one detected duplicate set for the UI. Members
// are listed oldest-first (stable: id tie-break) so the card reads like the
// history of the copies; the canonical survivor is chosen with the same
// sharedRankLess the merge uses.
func buildSharedCluster(members []Item, groupsOf map[string][]string) SharedDuplicateCluster {
	sorted := append([]Item{}, members...)
	for i := 1; i < len(sorted); i++ {
		for j := i; j > 0; j-- {
			a, b := sorted[j], sorted[j-1]
			if a.CreatedAt < b.CreatedAt || (a.CreatedAt == b.CreatedAt && a.ID < b.ID) {
				sorted[j], sorted[j-1] = sorted[j-1], sorted[j]
			} else {
				break
			}
		}
	}
	canonical := sorted[0]
	for _, it := range sorted[1:] {
		if sharedRankLess(it, canonical) {
			canonical = it
		}
	}

	span := map[string]bool{}
	for _, it := range sorted {
		for _, name := range groupsOf[it.ID] {
			span[name] = true
		}
	}
	groupNames := make([]string, 0, len(span))
	for name := range span {
		groupNames = append(groupNames, name)
	}
	sortStrings(groupNames)

	cluster := SharedDuplicateCluster{
		ItemID:     canonical.ID,
		Name:       canonical.Name,
		Key:        canonical.Key,
		Copies:     len(sorted),
		GroupNames: groupNames,
		Members:    make([]SharedDuplicateMember, 0, len(sorted)),
	}
	for _, it := range sorted {
		names := append([]string{}, groupsOf[it.ID]...) // never nil in JSON
		if names == nil {
			names = []string{}
		}
		cluster.Members = append(cluster.Members, SharedDuplicateMember{
			ItemID:     it.ID,
			Name:       it.Name,
			Key:        it.Key,
			GroupNames: names,
		})
	}
	return cluster
}

// MergeSharedDuplicates consolidates K identical items into ONE shared
// credential, atomically (a single save): the canonical copy survives with
// shared=true; every live items-mode group that referenced any copy now
// references the canonical, at the first copy's position; the other copies
// are soft-deleted to the Trash WITH tombstones (§46 semantics — a stale
// backup can never resurrect them as live duplicates), recoverable from the
// Trash for 30 days like every delete. Usage stats merge honestly: useCount
// sums, lastUsedAt keeps the latest, pinned survives if any copy had it.
//
// Apply-time re-validation: every item must still exist and be live, and
// every value must still be identical — a confirmation made before an edit
// is REFUSED, never silently resolved.
func (s *Store) MergeSharedDuplicates(itemIDs []string) (Item, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.assertWritable(); err != nil {
		return Item{}, err
	}
	ids := make([]string, 0, len(itemIDs))
	for _, id := range itemIDs {
		if !containsStr(ids, id) {
			ids = append(ids, id)
		}
	}
	if len(ids) < 2 {
		return Item{}, errors.New("select at least two identical items to merge")
	}
	var members []*Item
	for _, id := range ids {
		it := s.findItem(id)
		if it == nil || it.DeletedAt != nil {
			return Item{}, errors.New("one of these items no longer exists — scan again")
		}
		members = append(members, it)
	}
	value := members[0].Value
	if value == "" {
		return Item{}, errors.New("these items no longer hold the same value — scan again")
	}
	for _, m := range members[1:] {
		if m.Value != value {
			return Item{}, errors.New("these items no longer hold the same value — scan again")
		}
	}

	/* The canonical survivor — same rank the scan proposed. */
	canonical := members[0]
	for _, m := range members[1:] {
		if sharedRankLess(*m, *canonical) {
			canonical = m
		}
	}

	now := NowISO(s.now())
	memberSet := map[string]bool{}
	for _, id := range ids {
		memberSet[id] = true
	}

	/* Re-point every live items-mode group at the canonical, in place: the
	   first copy's slot becomes the shared reference, later duplicates of
	   the cluster collapse into that one reference. */
	for i := range s.data.Groups {
		g := &s.data.Groups[i]
		if g.DeletedAt != nil || g.IsDocumentGroup() {
			continue
		}
		changed := false
		kept := make([]string, 0, len(g.ItemIDs))
		for _, id := range g.ItemIDs {
			if !memberSet[id] {
				kept = append(kept, id)
				continue
			}
			changed = true
			if !containsStr(kept, canonical.ID) {
				kept = append(kept, canonical.ID)
			}
		}
		if changed {
			g.ItemIDs = kept
			g.UpdatedAt = now
		}
	}

	/* Absorb the duplicates: soft-delete to the Trash + tombstone, exactly
	   like a user delete (§42/§46) — but no undo token; the Trash IS the
	   recovery path for a merge. */
	useCount := 0
	var lastUsed *string
	pinned := false
	absorbed := make([]string, 0, len(members)-1)
	for _, m := range members {
		useCount += m.UseCount
		if m.Pinned {
			pinned = true
		}
		if m.LastUsedAt != nil && (lastUsed == nil || *m.LastUsedAt > *lastUsed) {
			lu := *m.LastUsedAt
			lastUsed = &lu
		}
		if m.ID == canonical.ID {
			continue
		}
		m.DeletedAt = &now
		m.UpdatedAt = now
		absorbed = append(absorbed, m.ID)
	}

	canonical.Shared = true
	canonical.UseCount = useCount
	canonical.LastUsedAt = lastUsed
	canonical.Pinned = pinned
	canonical.UpdatedAt = now

	if err := s.saveLocked(kindDaily); err != nil {
		return Item{}, err
	}
	s.addTombsLocked(absorbed, now)
	return *canonical, nil
}
