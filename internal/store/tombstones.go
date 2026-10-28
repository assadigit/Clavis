/**
 * CLAVIS — deletion tombstones (v1.4.1, DECISIONS.md §42).
 *
 * The user report: deleted entries kept coming back — a stale copy of the
 * app or a backup-recovery had re-written them into the data file as live.
 * The tombstone log is the guarantee that cannot happen silently anymore:
 * every delete is remembered in deletions.json, and whenever the vault is
 * loaded (start, recovery, reopen), any entry the file shows as LIVE but
 * that carries a tombstone is moved straight back to the Trash — with a
 * banner explaining what happened. Intentional un-deletes (Restore from
 * Trash, Undo, Restore backup) clear the tombstone, so nothing the user
 * does on purpose is ever fought.
 *
 * Retention: tombstones older than 90 days are pruned on write — far beyond
 * the 10-daily-backup window that could ever resurrect an entry.
 */
package store

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
	"time"
)

// tombstoneKeepDays bounds how long a deletion is remembered.
const tombstoneKeepDays = 90

// tombstoneMax bounds the log size (newest kept).
const tombstoneMax = 10000

type tombstoneFile struct {
	Version int               `json:"version"`
	Deleted map[string]string `json:"deleted"` // entry id → ISO timestamp of the delete
}

func (s *Store) tombsPath() string {
	return filepath.Join(s.dir, "deletions.json")
}

// loadTombsLocked reads deletions.json; a missing or damaged file means "no
// tombstones" (defense-in-depth must never brick the vault).
func (s *Store) loadTombsLocked() map[string]string {
	text, err := os.ReadFile(s.tombsPath())
	if err != nil {
		return map[string]string{}
	}
	var parsed tombstoneFile
	if json.Unmarshal(text, &parsed) != nil || parsed.Deleted == nil {
		return map[string]string{}
	}
	return parsed.Deleted
}

// saveTombsLocked prunes, stores in memory and writes the log atomically.
// Best-effort by design: the primary delete already persisted; the log is
// the safety net, and its failure must never fail the user's action.
func (s *Store) saveTombsLocked(m map[string]string) {
	cutoff := s.now().AddDate(0, 0, -tombstoneKeepDays)
	pruned := make(map[string]string, len(m))
	for id, iso := range m {
		if t := parseISO(iso); !t.IsZero() && t.Before(cutoff) {
			continue
		}
		pruned[id] = iso
	}
	if len(pruned) > tombstoneMax {
		type kv struct {
			k string
			t time.Time
		}
		all := make([]kv, 0, len(pruned))
		for id, iso := range pruned {
			all = append(all, kv{id, parseISO(iso)})
		}
		for i := 1; i < len(all); i++ {
			for j := i; j > 0 && all[j].t.Before(all[j-1].t); j-- {
				all[j], all[j-1] = all[j-1], all[j]
			}
		}
		keep := make(map[string]string, tombstoneMax)
		for _, e := range all[len(all)-tombstoneMax:] {
			keep[e.k] = pruned[e.k]
		}
		pruned = keep
	}
	s.tombs = pruned
	jsonBytes, err := json.MarshalIndent(tombstoneFile{Version: 1, Deleted: pruned}, "", "  ")
	if err != nil {
		return
	}
	tmp := s.uniqueTmpPath(s.tombsPath())
	if os.WriteFile(tmp, jsonBytes, 0o644) != nil {
		return
	}
	_ = os.Rename(tmp, s.tombsPath())
}

// addTombLocked remembers a deletion.
func (s *Store) addTombLocked(id, iso string) {
	m := make(map[string]string, len(s.tombs)+1)
	for k, v := range s.tombs {
		m[k] = v
	}
	m[id] = iso
	s.saveTombsLocked(m)
}

// removeTombLocked forgets deletions (intentional un-delete paths).
func (s *Store) removeTombLocked(ids ...string) {
	present := false
	for _, id := range ids {
		if _, ok := s.tombs[id]; ok {
			present = true
		}
	}
	if !present {
		return
	}
	m := make(map[string]string, len(s.tombs))
	for k, v := range s.tombs {
		drop := false
		for _, id := range ids {
			if k == id {
				drop = true
			}
		}
		if !drop {
			m[k] = v
		}
	}
	s.saveTombsLocked(m)
}

// clearTombsLocked forgets every deletion (Restore backup: the user has
// explicitly chosen a past state).
func (s *Store) clearTombsLocked() {
	s.saveTombsLocked(map[string]string{})
}

// applyTombsLocked moves every LIVE entry that carries a tombstone back to
// the Trash (deletedAt = the original delete time). Returns how many were
// re-deleted. Caller holds s.mu; the caller persists and notifies when > 0.
func (s *Store) applyTombsLocked() int {
	if len(s.tombs) == 0 || s.readOnly {
		return 0
	}
	n := 0
	for i := range s.data.Items {
		it := &s.data.Items[i]
		if it.DeletedAt == nil {
			if iso, ok := s.tombs[it.ID]; ok {
				t := iso
				it.DeletedAt = &t
				n++
			}
		}
	}
	for i := range s.data.Groups {
		g := &s.data.Groups[i]
		if g.DeletedAt == nil {
			if iso, ok := s.tombs[g.ID]; ok {
				t := iso
				g.DeletedAt = &t
				n++
			}
		}
	}
	return n
}

// tombstoneNotice is the banner shown after tombstones were re-applied.
func tombstoneNotice(n int) string {
	word := "entries"
	if n == 1 {
		word = "entry"
	}
	return "Clavis noticed " + strconv.Itoa(n) + " deleted " + word +
		" that had reappeared — an old backup or a second copy of the app may have brought them back. " +
		"They were moved back to the Trash. If you actually want them, restore them from the Trash."
}
