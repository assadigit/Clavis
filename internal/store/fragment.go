/**
 * CLAVIS — fragment export & import (UI-audit round 1, Phase 4; F-017).
 *
 * A "clavis-fragment" is a lossless partial export scoped to one item or one
 * group: the same row shapes the full backup uses, minus the vault wrapper
 * (no schemaVersion/settings). The owner's flow — export one group here,
 * import it on another machine — round-trips notes, tags, per-item secret
 * flags, pins and the exact member order, because Item and Group ride along
 * verbatim.
 *
 * Compatibility contract:
 *   - old Clavis versions never see a fragment (files only appear when a
 *     user exports one), and this version still imports old full backups
 *     byte-identically in behavior — fragments are detected FIRST and are
 *     never mistaken for a vault (a vault has schemaVersion, not kind);
 *   - values ride the same plaintext-as-backup path the full backup already
 *     uses — no storage or protection logic is involved (off-limits areas
 *     untouched).
 *
 * SECURITY: values pass through this file and are never logged.
 */
package store

import (
	"encoding/json"
	"errors"
	"time"

	"clavis/internal/exchange"
)

const fragmentKind = "clavis-fragment"

// CurrentFragmentVersion bumps whenever the fragment shape changes in a way
// older readers cannot merge safely.
const CurrentFragmentVersion = 1

// FragmentScope names what the fragment contains.
type FragmentScope struct {
	Type string `json:"type"` // "item" | "group"
	ID   string `json:"id"`
	Name string `json:"name"`
}

// Fragment is a lossless partial export. Row shapes are byte-compatible
// with VaultData's so the JSON tags never drift from the backup format.
type Fragment struct {
	Kind             string        `json:"kind"`
	FragmentVersion  int           `json:"fragmentVersion"`
	ExportedAt       string        `json:"exportedAt"`
	SourceAppVersion string        `json:"sourceAppVersion"`
	Scope            FragmentScope `json:"scope"`
	Categories       []Category    `json:"categories"`
	Groups           []Group       `json:"groups"`
	Items            []Item        `json:"items"`
}

// ExportEntryFragment writes a group (with its member items) or a single
// item as a clavis-fragment JSON (§5.8, owner feature request).
func (s *Store) ExportEntryFragment(kind EntryKind, id string) (ExportTarget, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if kind == KindGroup {
		group := s.findGroup(id)
		if group == nil || group.DeletedAt != nil {
			return ExportTarget{}, notFound("Group", id)
		}
		members, err := s.groupMembersLocked(id)
		if err != nil {
			return ExportTarget{}, err
		}
		// groupMembersLocked already drops soft-deleted members, so the
		// export is lossless for live vaults by construction.
		items := make([]Item, 0, len(members))
		for _, m := range members {
			items = append(items, m.Item)
		}
		frag := Fragment{
			Kind:             fragmentKind,
			FragmentVersion:  CurrentFragmentVersion,
			ExportedAt:       NowISO(s.now()),
			SourceAppVersion: s.appVersion,
			Scope:            FragmentScope{Type: "group", ID: group.ID, Name: group.Name},
			Categories:       fragmentCategories(s.data.Categories, group.CategoryID, items),
			Groups:           []Group{*group},
			Items:            items,
		}
		return marshalFragment(frag, "group", group.Name, s.now())
	}
	if kind == KindItem {
		item := s.findItem(id)
		if item == nil || item.DeletedAt != nil {
			return ExportTarget{}, notFound("Item", id)
		}
		frag := Fragment{
			Kind:             fragmentKind,
			FragmentVersion:  CurrentFragmentVersion,
			ExportedAt:       NowISO(s.now()),
			SourceAppVersion: s.appVersion,
			Scope:            FragmentScope{Type: "item", ID: item.ID, Name: item.Name},
			Categories:       fragmentCategories(s.data.Categories, item.CategoryID, nil),
			Groups:           []Group{},
			Items:            []Item{*item},
		}
		return marshalFragment(frag, "item", item.Name, s.now())
	}
	return ExportTarget{}, notFound("Entry", id)
}

// fragmentCategories collects the distinct categories the exported rows
// reference (the group's own plus every member's), nil-safe.
func fragmentCategories(all []Category, primary *string, items []Item) []Category {
	seen := map[string]bool{}
	out := []Category{}
	add := func(cid *string) {
		if cid == nil || seen[*cid] {
			return
		}
		seen[*cid] = true
		for i := range all {
			if all[i].ID == *cid {
				out = append(out, all[i])
				return
			}
		}
		// A dangling reference is simply not exported; merge re-links nothing.
	}
	add(primary)
	for i := range items {
		add(items[i].CategoryID)
	}
	return out
}

func marshalFragment(f Fragment, what, name string, now time.Time) (ExportTarget, error) {
	body, err := json.MarshalIndent(f, "", "  ")
	if err != nil {
		return ExportTarget{}, err
	}
	filename := "clavis-" + what + "-" + exchange.SafeFilename(name) + "-" + now.Format("20060102-1504") + ".json"
	return ExportTarget{Body: string(body), Filename: filename}, nil
}

// parseFragment returns the fragment only when the text explicitly declares
// itself one. Full backups (schemaVersion, no kind) and garbage both return
// ok=false, so the existing vault paths are never bypassed by mistake.
func parseFragment(jsonText string) (Fragment, bool) {
	var probe struct {
		Kind string `json:"kind"`
	}
	if err := json.Unmarshal([]byte(jsonText), &probe); err != nil || probe.Kind != fragmentKind {
		return Fragment{}, false
	}
	var f Fragment
	if err := json.Unmarshal([]byte(jsonText), &f); err != nil {
		return Fragment{}, false
	}
	return f, f.Kind == fragmentKind
}

// fragmentNewerVersion mirrors the vault newer-schema guard message.
func fragmentNewerVersion() error {
	return errors.New("This partial export was created by a newer version of Clavis. Please update the app.")
}

// importFragmentLocked merges a fragment with the exact semantics of
// ImportBackup's merge branch: categories by ID (add missing), then items,
// then groups — newer updatedAt wins, ids never re-generated. Membership
// order survives because Group.ItemIDs rides along inside the Group row.
// The caller holds the lock and has already taken the pre-import backup.
func (s *Store) importFragmentLocked(f Fragment) (ImportSummary, error) {
	if f.FragmentVersion > CurrentFragmentVersion {
		return ImportSummary{}, fragmentNewerVersion()
	}
	var summary ImportSummary
	for _, inc := range f.Categories {
		if inc.ID == "" || s.findCategoryLocked(inc.ID) != nil {
			continue
		}
		s.data.Categories = append(s.data.Categories, inc)
	}
	for _, inc := range f.Items {
		if inc.DeletedAt != nil || inc.ID == "" { // defense in depth
			continue
		}
		if existing := s.findItem(inc.ID); existing == nil {
			s.data.Items = append(s.data.Items, inc)
			summary.Added++
		} else if inc.UpdatedAt > existing.UpdatedAt {
			*existing = inc
			summary.Updated++
		} else {
			summary.Skipped++
		}
	}
	for _, inc := range f.Groups {
		if inc.DeletedAt != nil || inc.ID == "" { // defense in depth
			continue
		}
		if existing := s.findGroup(inc.ID); existing == nil {
			s.data.Groups = append(s.data.Groups, inc)
			summary.Added++
		} else if inc.UpdatedAt > existing.UpdatedAt {
			*existing = inc
			summary.Updated++
		} else {
			summary.Skipped++
		}
	}
	return summary, s.writeAtomicLocked()
}
