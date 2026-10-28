/**
 * CLAVIS — import & export (SPEC §5.8).
 *
 * Full backup JSON (Replace everything / Merge) plus Markdown/TXT files with
 * the spec'd duplicate handling (Reuse existing / Keep both / Apply to all).
 * SECURITY: values are never logged; conflicts carry names only.
 */
package store

import (
	"errors"
	"path/filepath"
	"strings"

	"clavis/internal/exchange"
)

// ExportBackupString is the "Export everything" payload (§5.8A).
func (s *Store) ExportBackupString() (string, error) {
	b, err := s.ReadVaultBytes()
	return string(b), err
}

// ExportTarget is a generated file body + suggested file name.
type ExportTarget struct {
	Body     string
	Filename string
}

// ExportEntryMarkdown renders an item/group as Clavis Markdown (§5.8B).
func (s *Store) ExportEntryMarkdown(kind EntryKind, id string) (ExportTarget, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	catName := func(cid *string) string {
		if cid == nil {
			return ""
		}
		for _, c := range s.data.Categories {
			if c.ID == *cid {
				return c.Name
			}
		}
		return ""
	}
	if kind == KindItem {
		item := s.findItem(id)
		if item == nil || item.DeletedAt != nil {
			return ExportTarget{}, notFound("Item", id)
		}
		return ExportTarget{
			Body:     exchange.ExportItemMarkdown(exchange.MdItem{Name: item.Name, Key: item.Key, Value: item.Value, Note: item.Note, CategoryID: item.CategoryID, Tags: item.Tags, IsSecret: item.IsSecret}, catName(item.CategoryID)),
			Filename: exchange.SafeFilename(item.Name) + ".md",
		}, nil
	}
	group := s.findGroup(id)
	if group == nil || group.DeletedAt != nil {
		return ExportTarget{}, notFound("Group", id)
	}
	// Document groups (§40) export the pasted file itself, verbatim, with a
	// "mode: document" header so the import round-trips.
	if group.IsDocumentGroup() {
		return ExportTarget{
			Body:     exchange.ExportGroupMarkdown(exchange.MdGroup{Name: group.Name, CategoryID: group.CategoryID, Tags: group.Tags, Mode: exchange.ModeDocument, Document: group.Document}, nil, catName(group.CategoryID)),
			Filename: exchange.SafeFilename(group.Name) + ".md",
		}, nil
	}
	members, err := s.groupMembersLocked(id)
	if err != nil {
		return ExportTarget{}, err
	}
	return ExportTarget{
		Body:     exchange.ExportGroupMarkdown(exchange.MdGroup{Name: group.Name, CategoryID: group.CategoryID, Tags: group.Tags}, membersToPairs(members), catName(group.CategoryID)),
		Filename: exchange.SafeFilename(group.Name) + ".md",
	}, nil
}

// ExportEntryText renders an item/group as plain text (§5.8B).
func (s *Store) ExportEntryText(kind EntryKind, id string) (ExportTarget, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if kind == KindItem {
		item := s.findItem(id)
		if item == nil || item.DeletedAt != nil {
			return ExportTarget{}, notFound("Item", id)
		}
		return ExportTarget{Body: exchange.ExportItemText(item.Value), Filename: exchange.SafeFilename(item.Name) + ".txt"}, nil
	}
	group := s.findGroup(id)
	if group == nil || group.DeletedAt != nil {
		return ExportTarget{}, notFound("Group", id)
	}
	// Document groups (§40): the .txt body is the verbatim document.
	if group.IsDocumentGroup() {
		return ExportTarget{Body: group.Document, Filename: exchange.SafeFilename(group.Name) + ".txt"}, nil
	}
	members, err := s.groupMembersLocked(id)
	if err != nil {
		return ExportTarget{}, err
	}
	return ExportTarget{Body: exchange.ExportGroupText(membersToPairs(members)), Filename: exchange.SafeFilename(group.Name) + ".txt"}, nil
}

// ExportAllMarkdown produces one .md per item and per group (§5.8B).
type ExportAllFile struct {
	Body     string
	Filename string
}

func (s *Store) ExportAllMarkdown() ([]ExportAllFile, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	catName := func(cid *string) string {
		if cid == nil {
			return ""
		}
		for _, c := range s.data.Categories {
			if c.ID == *cid {
				return c.Name
			}
		}
		return ""
	}
	used := map[string]int{}
	uniqueName := func(name, ext string) string {
		base := exchange.SafeFilename(name)
		key := strings.ToLower(base + ext)
		n := used[key]
		used[key] = n + 1
		if n == 0 {
			return base + ext
		}
		return base + "_" + itoa(n+1) + ext
	}
	var out []ExportAllFile
	for i := range s.data.Items {
		item := s.data.Items[i]
		if item.DeletedAt != nil {
			continue
		}
		body := exchange.ExportItemMarkdown(exchange.MdItem{Name: item.Name, Key: item.Key, Value: item.Value, Note: item.Note, CategoryID: item.CategoryID, Tags: item.Tags, IsSecret: item.IsSecret}, catName(item.CategoryID))
		out = append(out, ExportAllFile{Body: body, Filename: uniqueName(item.Name, ".md")})
	}
	for gi := range s.data.Groups {
		group := s.data.Groups[gi]
		if group.DeletedAt != nil {
			continue
		}
		if group.IsDocumentGroup() {
			body := exchange.ExportGroupMarkdown(exchange.MdGroup{Name: group.Name, CategoryID: group.CategoryID, Tags: group.Tags, Mode: exchange.ModeDocument, Document: group.Document}, nil, catName(group.CategoryID))
			out = append(out, ExportAllFile{Body: body, Filename: uniqueName(group.Name, ".md")})
			continue
		}
		members, err := s.groupMembersLocked(group.ID)
		if err != nil {
			continue
		}
		body := exchange.ExportGroupMarkdown(exchange.MdGroup{Name: group.Name, CategoryID: group.CategoryID, Tags: group.Tags}, membersToPairs(members), catName(group.CategoryID))
		out = append(out, ExportAllFile{Body: body, Filename: uniqueName(group.Name, ".md")})
	}
	return out, nil
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var b [20]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		b[i] = '-'
	}
	return string(b[i:])
}

// ImportBackupPreview validates a full-backup or fragment JSON and counts it
// (§5.8A; UI-audit round 1 Phase 4: fragments are detected first — a full
// backup is never mistaken for one, and vice versa).
func (s *Store) ImportBackupPreview(jsonText string) BackupPreview {
	if frag, ok := parseFragment(jsonText); ok {
		if frag.FragmentVersion > CurrentFragmentVersion {
			return BackupPreview{Valid: false, Error: "This partial export was created by a newer version of Clavis. Please update the app."}
		}
		return BackupPreview{Valid: true, Items: len(frag.Items), Groups: len(frag.Groups), Cats: len(frag.Categories), Fragment: &frag.Scope}
	}
	parsed, ok := s.parseVault(jsonText)
	if !ok {
		return BackupPreview{Valid: false, Error: "Not a valid Clavis backup file."}
	}
	return BackupPreview{Valid: true, Items: len(parsed.Items), Groups: len(parsed.Groups), Cats: len(parsed.Categories)}
}

// ImportBackup applies a full backup (Replace everything / Merge) or merges
// a clavis-fragment (§5.8A; UI-audit round 1 Phase 4). Fragments always merge
// — a fragment is not a vault, so the mode is ignored; the pre-import backup
// is taken either way.
func (s *Store) ImportBackup(mode, jsonText string) (ImportSummary, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.assertWritable(); err != nil {
		return ImportSummary{}, err
	}
	if frag, ok := parseFragment(jsonText); ok {
		if err := s.saveLocked(kindPreImport); err != nil {
			return ImportSummary{}, err
		}
		return s.importFragmentLocked(frag)
	}
	parsed, ok := s.parseVault(jsonText)
	if !ok {
		return ImportSummary{}, errors.New("Not a valid Clavis backup file.")
	}
	if parsed.SchemaVersion > CurrentSchemaVersion {
		return ImportSummary{}, errors.New("This backup was created by a newer version of Clavis. Please update the app.")
	}
	if err := s.saveLocked(kindPreImport); err != nil {
		return ImportSummary{}, err
	}
	if mode == "replace" {
		s.data = parsed
		s.data.AppVersion = s.appVersion
		if err := s.writeAtomicLocked(); err != nil {
			return ImportSummary{}, err
		}
		return ImportSummary{Added: len(parsed.Items) + len(parsed.Groups)}, nil
	}
	// Merge: add missing ids; when an id exists on both sides keep the one
	// with the newer updatedAt.
	var summary ImportSummary
	for _, inc := range parsed.Categories {
		if s.findCategoryLocked(inc.ID) == nil {
			s.data.Categories = append(s.data.Categories, inc)
		}
	}
	for _, inc := range parsed.Items {
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
	for _, inc := range parsed.Groups {
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

func (s *Store) findCategoryLocked(id string) *Category {
	for i := range s.data.Categories {
		if s.data.Categories[i].ID == id {
			return &s.data.Categories[i]
		}
	}
	return nil
}

func (s *Store) parseImportFile(name, content string) (exchange.Imported, error) {
	lower := strings.ToLower(name)
	if strings.HasSuffix(lower, ".json") {
		return exchange.Imported{}, errors.New("JSON files are imported with “Import backup”.")
	}
	if strings.HasSuffix(lower, ".md") {
		return exchange.ParseMarkdown(name, content)
	}
	return exchange.ParseText(name, content), nil
}

type conflictInfo struct {
	Kind         EntryKind
	Name         string
	ExistingName string
	Reason       string
}

func (s *Store) findConflictLocked(imp exchange.Imported) *conflictInfo {
	if imp.Kind == exchange.KindItem {
		for i := range s.data.Items {
			it := &s.data.Items[i]
			if it.DeletedAt == nil && it.Name == imp.Name {
				return &conflictInfo{Kind: KindItem, Name: imp.Name, ExistingName: it.Name, Reason: "name"}
			}
		}
		if imp.Key != "" {
			for i := range s.data.Items {
				it := &s.data.Items[i]
				if it.DeletedAt == nil && it.Key != "" && it.Key == imp.Key {
					return &conflictInfo{Kind: KindItem, Name: imp.Name, ExistingName: it.Name, Reason: "key"}
				}
			}
		}
		return nil
	}
	for i := range s.data.Groups {
		g := &s.data.Groups[i]
		if g.DeletedAt == nil && g.Name == imp.Name {
			return &conflictInfo{Kind: KindGroup, Name: imp.Name, ExistingName: g.Name, Reason: "name"}
		}
	}
	return nil
}

// ImportFilesPreview parses import files and lists conflicts (names only).
func (s *Store) ImportFilesPreview(files []ImportedFile) FilesPreview {
	s.mu.Lock()
	defer s.mu.Unlock()
	var conflicts []ImportConflict
	parsedCount := 0
	for i, f := range files {
		imp, err := s.parseImportFile(f.Name, f.Content)
		if err != nil {
			continue
		}
		parsedCount++
		if c := s.findConflictLocked(imp); c != nil {
			conflicts = append(conflicts, ImportConflict{
				FileIndex: i, FileName: f.Name, Kind: c.Kind, Name: c.Name,
				ExistingName: c.ExistingName, Reason: c.Reason,
			})
		}
		if imp.Kind == exchange.KindGroup {
			for _, line := range imp.Lines {
				for gi := range s.data.Items {
					it := &s.data.Items[gi]
					if it.DeletedAt == nil && it.Key != "" && it.Key == line.Key {
						conflicts = append(conflicts, ImportConflict{
							FileIndex: i, FileName: f.Name, Kind: KindItem, Name: line.Key,
							ExistingName: it.Name, Reason: "key",
						})
						break
					}
				}
			}
		}
	}
	if conflicts == nil {
		conflicts = []ImportConflict{}
	}
	return FilesPreview{Conflicts: conflicts, ParsedCount: parsedCount}
}

// ImportFilesApply applies an .md/.txt import with the spec'd resolution
// (§5.8B duplicate handling).
func (s *Store) ImportFilesApply(files []ImportedFile, res ImportResolution) (ImportSummary, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.assertWritable(); err != nil {
		return ImportSummary{}, err
	}
	if err := s.saveLocked(kindPreImport); err != nil {
		return ImportSummary{}, err
	}
	var summary ImportSummary

	reuseOrCreateItem := func(name, key, value string, categoryID *string, tags []string, isSecret bool, reuse bool) string {
		if reuse {
			var existing *Item
			for i := range s.data.Items {
				it := &s.data.Items[i]
				if it.DeletedAt == nil && it.Name == name {
					existing = it
					break
				}
			}
			if existing == nil && key != "" {
				for i := range s.data.Items {
					it := &s.data.Items[i]
					if it.DeletedAt == nil && it.Key != "" && it.Key == key {
						existing = it
						break
					}
				}
			}
			if existing != nil {
				summary.Skipped++
				return existing.ID
			}
		}
		now := NowISO(s.now())
		item := Item{
			ID: s.newID(), Name: name, Key: key, Value: value, Note: "",
			CategoryID: categoryID, Tags: tags, IsSecret: isSecret, Pinned: false,
			UseCount: 0, LastUsedAt: nil, CreatedAt: now, UpdatedAt: now, DeletedAt: nil,
		}
		s.data.Items = append(s.data.Items, item)
		summary.Added++
		return item.ID
	}
	resolveCategory := func(categoryName string) *string {
		if categoryName == "" {
			return nil
		}
		for i := range s.data.Categories {
			if strings.EqualFold(s.data.Categories[i].Name, categoryName) {
				return &s.data.Categories[i].ID
			}
		}
		sortOrder := -1
		for _, c := range s.data.Categories {
			if c.SortOrder > sortOrder {
				sortOrder = c.SortOrder
			}
		}
		cat := Category{ID: s.newID(), Name: categoryName, SortOrder: sortOrder + 1}
		s.data.Categories = append(s.data.Categories, cat)
		return &s.data.Categories[len(s.data.Categories)-1].ID
	}

	for fi, f := range files {
		imp, err := s.parseImportFile(f.Name, f.Content)
		if err != nil {
			continue
		}
		conflict := s.findConflictLocked(imp)
		hasConflict := conflict != nil
		fileChoice := res.Choice
		for _, pf := range res.PerFile {
			if pf.FileIndex == fi {
				fileChoice = pf.Choice
				break
			}
		}
		choice := "create"
		if hasConflict && fileChoice == "reuse" {
			choice = "reuse"
		}
		memberChoice := "create"
		if fileChoice == "reuse" {
			memberChoice = "reuse"
		}

		if imp.Kind == exchange.KindItem {
			reuseOrCreateItem(imp.Name, imp.Key, imp.Value, resolveCategory(imp.CategoryName), imp.Tags, imp.IsSecret, choice == "reuse")
			continue
		}

		categoryID := resolveCategory(imp.CategoryName)

		// Whole-document group import (§40): the body IS the document.
		if imp.Mode == exchange.ModeDocument {
			groupName := imp.Name
			if hasConflict && choice == "create" {
				groupName = s.uniqueGroupName(imp.Name)
			}
			now := NowISO(s.now())
			s.data.Groups = append(s.data.Groups, Group{
				ID: s.newID(), Name: groupName, CategoryID: categoryID, Tags: imp.Tags,
				ItemIDs: []string{}, Mode: GroupModeDocument, Document: imp.Document,
				IsSecret: imp.IsSecret, Pinned: false, UseCount: 0, LastUsedAt: nil,
				CreatedAt: now, UpdatedAt: now, DeletedAt: nil,
			})
			summary.Added++
			continue
		}

		if hasConflict && choice == "reuse" {
			var existing *Group
			for i := range s.data.Groups {
				g := &s.data.Groups[i]
				if g.DeletedAt == nil && g.Name == imp.Name {
					existing = g
					break
				}
			}
			if existing != nil {
				for _, line := range imp.Lines {
					itemID := reuseOrCreateItem(line.Key, line.Key, line.Value, categoryID, imp.Tags, imp.IsSecret, memberChoice == "reuse")
					if !containsStr(existing.ItemIDs, itemID) {
						existing.ItemIDs = append(existing.ItemIDs, itemID)
					}
				}
				existing.UpdatedAt = NowISO(s.now())
				continue
			}
		}
		groupName := imp.Name
		if hasConflict && choice == "create" {
			groupName = s.uniqueGroupName(imp.Name)
		}
		now := NowISO(s.now())
		group := Group{
			ID: s.newID(), Name: groupName, CategoryID: categoryID, Tags: imp.Tags,
			ItemIDs: []string{}, Pinned: false, UseCount: 0, LastUsedAt: nil,
			CreatedAt: now, UpdatedAt: now, DeletedAt: nil,
		}
		for _, line := range imp.Lines {
			itemID := reuseOrCreateItem(line.Key, line.Key, line.Value, categoryID, imp.Tags, imp.IsSecret, memberChoice == "reuse")
			if !containsStr(group.ItemIDs, itemID) {
				group.ItemIDs = append(group.ItemIDs, itemID)
			}
		}
		s.data.Groups = append(s.data.Groups, group)
		summary.Added++
	}
	return summary, s.writeAtomicLocked()
}

// uniqueGroupName finds the first free "Name", "Name (2)", "Name (3)"…
// among live groups (§5.8B keep-both naming). Caller holds the lock.
func (s *Store) uniqueGroupName(base string) string {
	name := base
	for n := 2; ; n++ {
		taken := false
		for i := range s.data.Groups {
			if s.data.Groups[i].DeletedAt == nil && s.data.Groups[i].Name == name {
				taken = true
				break
			}
		}
		if !taken {
			return name
		}
		name = base + " (" + itoa(n) + ")"
	}
}

// sanitizeImportPath keeps only the base name for display.
func sanitizeImportPath(name string) string { return filepath.Base(name) }
