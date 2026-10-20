/**
 * CLAVIS — search & ranking (SPEC §5.1), Go mirror of the frontend
 * algorithm. THE documented algorithm:
 *
 * 1. The query is split on whitespace into tokens. A token starting with
 *    "#" restricts to entries whose tags match (case-insensitive); a token
 *    starting with "@" restricts to a category name; any other token is a
 *    plain word. ALL tokens must match (AND).
 * 2. A plain word matches when it is a case-insensitive PREFIX of, or a
 *    fuzzy SUBSEQUENCE of, any of: name, key, note, category name, tag.
 *    ("ghtk" finds "GitHub token".)
 * 3. Secret values are NEVER matched — they are not part of the index.
 * 4. Ranking: exact name match first, then name prefix, then anything
 *    else; within the same tier: pinned, then useCount, then lastUsedAt.
 * 5. Empty query: pinned first, then most-used. The popup shows 8 rows.
 */
package search

import (
	"sort"
	"strings"
	"time"

	"clavis/internal/store"
)

// Entry is the indexed view of an item or group (no values!).
type Entry struct {
	Kind         store.EntryKind
	ID           string
	Name         string
	Key          string // "" for groups
	Note         string // "" for groups
	CategoryName string // "" when no category
	Tags         []string
	Pinned       bool
	UseCount     int
	LastUsedAt   int64 // epoch ms; 0 when never used
}

// BuildEntries indexes a vault (skips soft-deleted, skips values).
func BuildEntries(data store.VaultData) []Entry {
	catNames := map[string]string{}
	for _, c := range data.Categories {
		catNames[c.ID] = c.Name
	}
	entries := []Entry{}
	for _, it := range data.Items {
		if it.DeletedAt != nil {
			continue
		}
		categoryName := ""
		if it.CategoryID != nil {
			categoryName = catNames[*it.CategoryID]
		}
		entries = append(entries, Entry{
			Kind: store.KindItem, ID: it.ID, Name: it.Name, Key: it.Key,
			Note: it.Note, CategoryName: categoryName, Tags: it.Tags,
			Pinned: it.Pinned, UseCount: it.UseCount, LastUsedAt: epochMillis(it.LastUsedAt),
		})
	}
	for _, g := range data.Groups {
		if g.DeletedAt != nil {
			continue
		}
		categoryName := ""
		if g.CategoryID != nil {
			categoryName = catNames[*g.CategoryID]
		}
		entries = append(entries, Entry{
			Kind: store.KindGroup, ID: g.ID, Name: g.Name, Key: "", Note: "",
			CategoryName: categoryName, Tags: g.Tags,
			Pinned: g.Pinned, UseCount: g.UseCount, LastUsedAt: epochMillis(g.LastUsedAt),
		})
	}
	return entries
}

func epochMillis(s *string) int64 {
	if s == nil || *s == "" {
		return 0
	}
	if t, err := time.Parse(time.RFC3339Nano, *s); err == nil {
		return t.UnixMilli()
	}
	return 0
}

type ParsedQuery struct {
	Words []string
	Tags  []string
	Cats  []string
}

// ParseQuery splits the query into words, #tags and @categories.
func ParseQuery(query string) ParsedQuery {
	var q ParsedQuery
	for _, token := range strings.Fields(query) {
		if token == "" {
			continue
		}
		if strings.HasPrefix(token, "#") && len(token) > 1 {
			q.Tags = append(q.Tags, strings.ToLower(token[1:]))
		} else if strings.HasPrefix(token, "@") && len(token) > 1 {
			q.Cats = append(q.Cats, strings.ToLower(token[1:]))
		} else {
			q.Words = append(q.Words, strings.ToLower(token))
		}
	}
	return q
}

// IsSubsequence reports whether word is a subsequence of field (runes).
func IsSubsequence(word, field string) bool {
	wr := []rune(word)
	i := 0
	for _, ch := range field {
		if i < len(wr) && ch == wr[i] {
			i++
		}
	}
	return i == len(wr)
}

// wordTier: 0 = no match, 1 = fuzzy/other field, 2 = name prefix, 3 = exact.
func wordTier(word string, e Entry) int {
	name := strings.ToLower(e.Name)
	if name == word {
		return 3
	}
	if strings.HasPrefix(name, word) {
		return 2
	}
	fields := []string{
		name,
		strings.ToLower(e.Key),
		strings.ToLower(e.Note),
		strings.ToLower(e.CategoryName),
	}
	for _, t := range e.Tags {
		fields = append(fields, strings.ToLower(t))
	}
	for _, f := range fields {
		if strings.HasPrefix(f, word) || IsSubsequence(word, f) {
			return 1
		}
	}
	return 0
}

func compareEntries(a, b Entry) int {
	if b.Pinned != a.Pinned {
		if b.Pinned {
			return 1
		}
		return -1
	}
	if b.UseCount != a.UseCount {
		if b.UseCount > a.UseCount {
			return 1
		}
		return -1
	}
	if b.LastUsedAt != a.LastUsedAt {
		if b.LastUsedAt > a.LastUsedAt {
			return 1
		}
		return -1
	}
	return strings.Compare(a.Name, b.Name)
}

type tiered struct {
	tier int
	e    Entry
}

// Search filters and ranks entries for the query.
func Search(query string, entries []Entry) []Entry {
	q := ParseQuery(query)

	filtered := entries
	if len(q.Tags) > 0 {
		out := filtered[:0:0]
		for _, e := range filtered {
			match := true
			for _, t := range q.Tags {
				found := false
				for _, et := range e.Tags {
					if strings.Contains(strings.ToLower(et), t) {
						found = true
						break
					}
				}
				if !found {
					match = false
					break
				}
			}
			if match {
				out = append(out, e)
			}
		}
		filtered = out
	}
	if len(q.Cats) > 0 {
		out := filtered[:0:0]
		for _, e := range filtered {
			c := strings.ToLower(e.CategoryName)
			match := true
			for _, cat := range q.Cats {
				if !strings.Contains(c, cat) {
					match = false
					break
				}
			}
			if match {
				out = append(out, e)
			}
		}
		filtered = out
	}

	if len(q.Words) == 0 {
		// Empty (or filter-only) query: pinned first, then most-used.
		out := append([]Entry{}, filtered...)
		sort.SliceStable(out, func(i, j int) bool { return compareEntries(out[i], out[j]) < 0 })
		return out
	}

	ranked := []tiered{}
	for _, e := range filtered {
		tier := 1 << 30
		ok := true
		for _, w := range q.Words {
			t := wordTier(w, e)
			if t == 0 {
				ok = false
				break
			}
			if t < tier {
				tier = t
			}
		}
		if ok {
			ranked = append(ranked, tiered{tier: tier, e: e})
		}
	}
	sort.SliceStable(ranked, func(i, j int) bool {
		if ranked[i].tier != ranked[j].tier {
			return ranked[i].tier > ranked[j].tier
		}
		return compareEntries(ranked[i].e, ranked[j].e) < 0
	})
	out := make([]Entry, len(ranked))
	for i, t := range ranked {
		out[i] = t.e
	}
	return out
}
