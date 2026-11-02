/**
 * CLAVIS — deletion tombstones (v1.4.1, DECISIONS.md §42; hardened v1.6.0,
 * DECISIONS.md §46).
 *
 * The user report: deleted entries kept coming back — a stale copy of the
 * app or a backup-recovery had re-written them into the data file as live.
 * The tombstone log is the guarantee that cannot happen silently anymore:
 * every delete is remembered in deletions.json, and whenever the vault is
 * loaded (start, recovery, reopen) — or changed by an IMPORT (v1.6.0) — any
 * entry the file shows as LIVE but that carries a tombstone is moved
 * straight back to the Trash, with a banner explaining what happened.
 * Intentional un-deletes (Restore from Trash, Undo, Restore backup) clear
 * the tombstone, so nothing the user does on purpose is ever fought.
 *
 * v1.6.0 retention: tombstones no longer age out. The ten newest DAILY
 * backups are kept FOREVER, so a tombstone that expired while such a backup
 * still held the entry live could be defeated by a damage-recovery — the
 * 90-day prune of v1.4.1 was shorter-sighted than the backup policy it
 * guarded against. The log is bounded by count instead (newest 10000
 * tombstones): even a maximal log is a few hundred KB, and 10000 deletions
 * is years of use. Hard purges (delete forever, empty trash, the 30-day
 * trash purge) now WRITE tombstones too, so "gone" stays gone.
 */
package store

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
	"time"
)

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

// saveTombsLocked stores the log in memory and writes it atomically, keeping
// only the newest tombstoneMax entries. Best-effort by design: the primary
// delete already persisted; the log is the safety net, and its failure must
// never fail the user's action.
func (s *Store) saveTombsLocked(m map[string]string) {
	if len(m) > tombstoneMax {
		type kv struct {
			k string
			t time.Time
		}
		all := make([]kv, 0, len(m))
		for id, iso := range m {
			all = append(all, kv{id, parseISO(iso)})
		}
		for i := 1; i < len(all); i++ {
			for j := i; j > 0 && all[j].t.Before(all[j-1].t); j-- {
				all[j], all[j-1] = all[j-1], all[j]
			}
		}
		keep := make(map[string]string, tombstoneMax)
		for _, e := range all[len(all)-tombstoneMax:] {
			keep[e.k] = m[e.k]
		}
		m = keep
	}
	s.tombs = m
	jsonBytes, err := json.MarshalIndent(tombstoneFile{Version: 1, Deleted: m}, "", "  ")
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

// addTombsLocked remembers several deletions at once (hard purges: delete
// forever, empty trash, the 30-day trash purge — v1.6.0: a purged entry can
// never be resurrected live by an import, a fragment merge or a backup).
func (s *Store) addTombsLocked(ids []string, iso string) {
	if len(ids) == 0 {
		return
	}
	m := make(map[string]string, len(s.tombs)+len(ids))
	for k, v := range s.tombs {
		m[k] = v
	}
	for _, id := range ids {
		m[id] = iso
	}
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

// applyTombsLocked moves every LIVE entry that carries a tombstone back to
// the Trash (deletedAt = the original delete time). Returns how many were
// re-deleted. Caller holds s.mu; the caller persists and notifies when > 0.
//
// v1.6.0 (DECISIONS.md §46): also used by the IMPORT paths — an imported
// backup/fragment that carries a tombstoned entry back as live is corrected
// in the SAME action, not at the next app start.
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

// enforceTombsLocked applies the tombstone log to the CURRENT in-memory
// vault and sets the banner when anything was corrected. It is the
// import-time twin of finishLoadLocked's apply step (v1.6.0, DECISIONS §46):
// an imported backup or fragment that carries a tombstoned entry back as
// LIVE is moved to the Trash in the SAME action — never shown live, never
// left for the next app start. Caller holds s.mu and persists afterwards.
func (s *Store) enforceTombsLocked() {
	if n := s.applyTombsLocked(); n > 0 {
		notice := tombstoneNotice(n)
		if s.recoveredNotice != nil {
			notice = *s.recoveredNotice + " " + notice
		}
		s.recoveredNotice = &notice
	}
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
