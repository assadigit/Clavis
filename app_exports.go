/**
 * CLAVIS — export/import dialog glue (SPEC §5.8).
 *
 * The file BODIES are built by the pure store; this file only drives the
 * native save/open dialogs and writes the chosen paths.
 */
package main

import (
	"os"
	"path/filepath"
	"strings"
	"time"

	"clavis/internal/service"
	"clavis/internal/store"
	"clavis/internal/system"
)

/* ------------------------- exports ------------------------- */

// ExportSave generates then saves one export through the Windows dialog.
func (c *Clavis) ExportSave(what, id string) map[string]any {
	var body, filename, filterName, pattern string
	switch what {
	case "backup":
		b, err := c.core.Store.ExportBackupString()
		if err != nil {
			return service.Fail("Could not build the backup.", 400)
		}
		body = b
		filename = "clavis-backup-" + time.Now().Format("20060102-1504") + ".json"
		filterName, pattern = "Clavis backup", "*.json"
	case "item-md", "group-md":
		target, err := c.core.Store.ExportEntryMarkdown(store.EntryKind(kindOf(what)), id)
		if err != nil {
			return service.FailErr(err)
		}
		body, filename = target.Body, target.Filename
		filterName, pattern = "Markdown", "*.md"
	case "item-json", "group-json":
		target, err := c.core.Store.ExportEntryFragment(store.EntryKind(kindOf(what)), id)
		if err != nil {
			return service.FailErr(err)
		}
		body, filename = target.Body, target.Filename
		filterName, pattern = "Clavis partial backup", "*.json"
	case "item-txt", "group-txt":
		target, err := c.core.Store.ExportEntryText(store.EntryKind(kindOf(what)), id)
		if err != nil {
			return service.FailErr(err)
		}
		body, filename = target.Body, target.Filename
		filterName, pattern = "Text", "*.txt"
	default:
		return service.Fail("Unknown export type.", 400)
	}

	dlg := c.app.Dialog.SaveFile().
		SetFilename(filename).
		AddFilter(filterName, pattern).
		CanCreateDirectories(true)
	if c.manager != nil && c.manager.IsVisible() {
		dlg = dlg.AttachToWindow(c.manager)
	}
	path, _ := dlg.PromptForSingleSelection()
	if path == "" {
		return map[string]any{"ok": false, "canceled": true}
	}
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		return service.Fail("Clavis could not write the file.", 400)
	}
	return map[string]any{"ok": true, "savedPath": path}
}

func kindOf(what string) string {
	if strings.HasPrefix(what, "item") {
		return string(store.KindItem)
	}
	return string(store.KindGroup)
}

// ExportAllMarkdown writes one .md per entry into a picked folder (§5.8B).
func (c *Clavis) ExportAllMarkdown() map[string]any {
	files, err := c.core.Store.ExportAllMarkdown()
	if err != nil {
		return service.FailErr(err)
	}
	if len(files) == 0 {
		return service.Fail("There is nothing to export yet.", 400)
	}
	dlg := c.app.Dialog.OpenFile().
		CanChooseDirectories(true).
		CanChooseFiles(false).
		CanCreateDirectories(true)
	if c.manager != nil && c.manager.IsVisible() {
		dlg = dlg.AttachToWindow(c.manager)
	}
	folder, _ := dlg.PromptForSingleSelection()
	if folder == "" {
		return map[string]any{"ok": false, "canceled": true}
	}
	written := 0
	for _, f := range files {
		if err := os.WriteFile(filepath.Join(folder, f.Filename), []byte(f.Body), 0o644); err == nil {
			written++
		}
	}
	if written == 0 {
		return service.Fail("Clavis could not write the files.", 400)
	}
	return map[string]any{"ok": true, "count": written, "folder": folder}
}

// ImportedFileDTO mirrors the frontend shape for picked import files.
type ImportedFileDTO struct {
	Name    string `json:"name"`
	Content string `json:"content"`
}

// Folder-import safety caps (UI-audit round 1 Phase 4, task 6): the folder
// import reads every matching file into memory at once; without a bound a
// giant folder could stall the app. Both limits are far above any sane
// credentials folder (one .md is a few KB).
const (
	importFolderMaxFiles = 200
	importFolderMaxBytes = 10 << 20 // 10 MB
)

// PickImportFolder picks a folder and reads its .md/.txt files (§5.8).
func (c *Clavis) PickImportFolder() map[string]any {
	dlg := c.app.Dialog.OpenFile().
		CanChooseDirectories(true).
		CanChooseFiles(false)
	if c.manager != nil && c.manager.IsVisible() {
		dlg = dlg.AttachToWindow(c.manager)
	}
	folder, _ := dlg.PromptForSingleSelection()
	if folder == "" {
		return map[string]any{"ok": false, "canceled": true}
	}
	var files []ImportedFileDTO
	var totalBytes int64
	entries, err := os.ReadDir(folder)
	if err != nil {
		return service.Fail("Clavis could not read that folder.", 400)
	}
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		name := e.Name()
		lower := strings.ToLower(name)
		if !strings.HasSuffix(lower, ".md") && !strings.HasSuffix(lower, ".txt") {
			continue
		}
		if len(files) >= importFolderMaxFiles {
			return service.Fail("That folder has more than 200 importable files. Import a smaller folder in batches, or use a full JSON backup.", 400)
		}
		b, err := os.ReadFile(filepath.Join(folder, name))
		if err != nil {
			continue
		}
		totalBytes += int64(len(b))
		if totalBytes > importFolderMaxBytes {
			return service.Fail("That folder's files add up to more than 10 MB. Import a smaller folder in batches, or use a full JSON backup.", 400)
		}
		files = append(files, ImportedFileDTO{Name: name, Content: string(b)})
	}
	if len(files) == 0 {
		return service.Fail("No .md or .txt files were found in that folder.", 400)
	}
	return map[string]any{"ok": true, "files": files}
}

// OpenDataFolder opens %APPDATA%\Clavis in Explorer (§5.9).
func (c *Clavis) OpenDataFolder() map[string]any {
	if err := system.OpenFolder(c.core.Store.DataDir()); err != nil {
		return service.Fail("Clavis could not open the data folder.", 400)
	}
	return map[string]any{"ok": true}
}

// OpenURL opens an http(s) link in the user's default browser (§40). The
// scheme is validated here AND in the dispatch core; anything but http/https
// is refused (a secrets app never runs arbitrary schemes).
func (c *Clavis) OpenURL(rawURL string) map[string]any {
	u := strings.TrimSpace(rawURL)
	low := strings.ToLower(u)
	if !strings.HasPrefix(low, "http://") && !strings.HasPrefix(low, "https://") {
		return service.Fail("Only http and https links can be opened.", 400)
	}
	if err := system.OpenURL(u); err != nil {
		return service.Fail("Clavis could not open the link.", 400)
	}
	return map[string]any{"ok": true}
}
