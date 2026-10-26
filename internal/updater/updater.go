/**
 * CLAVIS — self-update (user-requested extension; see DECISIONS.md §34).
 *
 * Checks the public GitHub releases of assadigit/Clavis, downloads the
 * matching artifact and swaps the app in place. The data folder
 * (%APPDATA%\Clavis) is never touched — an update replaces ONLY the exe.
 *
 * Network use is strictly pull-based: one GET to api.github.com (with a
 * releases.atom fallback when rate-limited) and one GET of the chosen
 * artifact. Nothing is ever sent anywhere.
 */
package updater

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

/* ------------------------- version comparison ------------------------- */

// ParseVersion turns "1.2.10"/"v1.2" into comparable numeric parts.
func ParseVersion(v string) [3]int {
	var out [3]int
	clean := strings.TrimSpace(strings.TrimPrefix(strings.ToLower(v), "v"))
	for i, part := range strings.SplitN(clean, ".", 3) {
		if i > 2 {
			break
		}
		digits := ""
		for _, r := range part {
			if r < '0' || r > '9' {
				break
			}
			digits += string(r)
		}
		if digits == "" {
			continue
		}
		n, err := strconv.Atoi(digits)
		if err == nil {
			out[i] = n
		}
	}
	return out
}

// IsNewer reports whether `latest` is strictly newer than `current`.
func IsNewer(current, latest string) bool {
	a := ParseVersion(current)
	b := ParseVersion(latest)
	for i := 0; i < 3; i++ {
		if b[i] != a[i] {
			return b[i] > a[i]
		}
	}
	return false
}

/* ------------------------- release discovery ------------------------- */

const (
	apiURL  = "https://api.github.com/repos/assadigit/Clavis/releases/latest"
	atomURL = "https://github.com/assadigit/Clavis/releases.atom"
	// latestPageURL is the canonical release page (fallback for foreign links).
	latestPageURL = "https://github.com/assadigit/Clavis/releases/latest"
	// officialBase is the only host/path the updater treats as "ours".
	officialBase = "https://github.com/assadigit/Clavis/"
)

// officialURL reports whether url is inside the Clavis repo on github.com.
// Release metadata is untrusted input (SC-2): a tampered API/atom response
// must not be able to steer the updater's download or the release-page
// button at another host.
func officialURL(url string) bool {
	return strings.HasPrefix(url, officialBase)
}

// Release is everything the UI needs about the latest GitHub release.
type Release struct {
	Tag          string
	Notes        string
	URL          string // release page
	SetupURL     string
	SetupSize    int64
	PortableURL  string
	PortableSize int64
}

// Status is a completed check.
type Status struct {
	Current   string
	Latest    string
	Available bool
	Release   Release
}

// Getter abstracts the HTTP calls so tests can serve fixtures.
type Getter func(url string) (int, []byte, error)

// HTTPGetter is the production Getter over net/http.
func HTTPGetter(timeout time.Duration) Getter {
	client := &http.Client{Timeout: timeout}
	return func(url string) (int, []byte, error) {
		req, err := http.NewRequest(http.MethodGet, url, nil)
		if err != nil {
			return 0, nil, err
		}
		req.Header.Set("User-Agent", "Clavis-Updater")
		req.Header.Set("Accept", "application/vnd.github+json")
		res, err := client.Do(req)
		if err != nil {
			return 0, nil, err
		}
		defer res.Body.Close()
		body, err := io.ReadAll(io.LimitReader(res.Body, 4<<20))
		if err != nil {
			return res.StatusCode, nil, err
		}
		return res.StatusCode, body, nil
	}
}

// FetchLatest reads the newest release: JSON API first, atom feed as the
// rate-limit fallback. Asset URLs are deterministic, so the fallback can
// reconstruct them from the tag.
func FetchLatest(get Getter) (Release, error) {
	rel, errAPI := fetchFromAPI(get)
	if errAPI == nil {
		return rel, nil
	}
	rel, errAtom := fetchFromAtom(get)
	if errAtom == nil {
		return rel, nil
	}
	return Release{}, fmt.Errorf("could not reach GitHub (%v / %v)", errAPI, errAtom)
}

type apiRelease struct {
	TagName string `json:"tag_name"`
	HTMLURL string `json:"html_url"`
	Body    string `json:"body"`
	Assets  []struct {
		Name               string `json:"name"`
		Size               int64  `json:"size"`
		BrowserDownloadURL string `json:"browser_download_url"`
	} `json:"assets"`
}

func fetchFromAPI(get Getter) (Release, error) {
	code, body, err := get(apiURL)
	if err != nil {
		return Release{}, err
	}
	if code != http.StatusOK {
		return Release{}, fmt.Errorf("github api status %d", code)
	}
	var parsed apiRelease
	if err := json.Unmarshal(body, &parsed); err != nil {
		return Release{}, err
	}
	if parsed.TagName == "" {
		return Release{}, errors.New("github api: no tag")
	}
	rel := Release{
		Tag:   parsed.TagName,
		Notes: strings.TrimSpace(parsed.Body),
		URL:   latestPageURL,
	}
	if officialURL(parsed.HTMLURL) {
		rel.URL = parsed.HTMLURL
	}
	for _, a := range parsed.Assets {
		if !officialURL(a.BrowserDownloadURL) {
			continue // foreign URL in a tampered response: treat as absent
		}
		switch {
		case strings.HasPrefix(a.Name, "Clavis-Setup-"):
			rel.SetupURL, rel.SetupSize = a.BrowserDownloadURL, a.Size
		case strings.HasPrefix(a.Name, "Clavis-Portable-"):
			rel.PortableURL, rel.PortableSize = a.BrowserDownloadURL, a.Size
		}
	}
	return rel, nil
}

var (
	atomEntryRe = regexp.MustCompile(`(?s)<entry>(.*?)</entry>`)
	atomIDRe    = regexp.MustCompile(`<id>[^<]*?/(v[\w.\-]+)</id>`)
	atomTitleRe = regexp.MustCompile(`(?s)<title>(.*?)</title>`)
	atomLinkRe  = regexp.MustCompile(`<link[^>]*href="([^"]+)"`)
	atomBodyRe  = regexp.MustCompile(`(?s)<content[^>]*>(.*?)</content>`)
)

func fetchFromAtom(get Getter) (Release, error) {
	code, body, err := get(atomURL)
	if err != nil {
		return Release{}, err
	}
	if code != http.StatusOK {
		return Release{}, fmt.Errorf("atom status %d", code)
	}
	entry := atomEntryRe.FindStringSubmatch(string(body))
	if entry == nil {
		return Release{}, errors.New("atom: no entry")
	}
	tag := atomIDRe.FindStringSubmatch(entry[1])
	if tag == nil {
		return Release{}, errors.New("atom: no tag")
	}
	ver := strings.TrimPrefix(tag[1], "v")
	notesPlain := ""
	if m := atomBodyRe.FindStringSubmatch(entry[1]); m != nil {
		notesPlain = stripTags(unescapeXML(m[1]))
	} else if t := atomTitleRe.FindStringSubmatch(entry[1]); t != nil {
		notesPlain = unescapeXML(t[1])
	}
	link := "https://github.com/assadigit/Clavis/releases/tag/" + tag[1]
	if l := atomLinkRe.FindStringSubmatch(entry[1]); l != nil && officialURL(l[1]) {
		link = l[1]
	}
	base := "https://github.com/assadigit/Clavis/releases/download/" + tag[1]
	return Release{
		Tag:         tag[1],
		Notes:       strings.TrimSpace(notesPlain),
		URL:         link,
		SetupURL:    base + "/Clavis-Setup-" + ver + ".exe",
		PortableURL: base + "/Clavis-Portable-" + ver + ".exe",
	}, nil
}

func unescapeXML(s string) string {
	r := strings.NewReplacer("&lt;", "<", "&gt;", ">", "&quot;", `"`, "&#39;", "'", "&amp;", "&")
	return r.Replace(s)
}

func stripTags(s string) string {
	text := regexp.MustCompile(`(?s)<[^>]+>`).ReplaceAllString(s, " ")
	return strings.Join(strings.Fields(text), " ")
}

// Check runs FetchLatest and compares against the running version.
func Check(get Getter, current string) (Status, error) {
	rel, err := FetchLatest(get)
	if err != nil {
		return Status{}, err
	}
	latest := strings.TrimPrefix(rel.Tag, "v")
	return Status{
		Current:   current,
		Latest:    latest,
		Available: IsNewer(current, latest),
		Release:   rel,
	}, nil
}

/* ------------------------- mode detection ------------------------- */

// Mode says how Clavis was launched on this machine.
type Mode string

const (
	ModeInstalled Mode = "installed"
	ModePortable  Mode = "portable"
)

// DetectMode compares the running exe's folder with the per-user install
// directory recorded by the NSIS installer (HKCU\Software\Clavis\InstallDir).
// installDir "" (registry miss / non-Windows) means portable.
func DetectMode(exePath, installDir string) Mode {
	if installDir == "" {
		return ModePortable
	}
	exeDir := filepath.Dir(filepath.Clean(exePath))
	if strings.EqualFold(filepath.Clean(exeDir), filepath.Clean(installDir)) {
		return ModeInstalled
	}
	return ModePortable
}

/* ------------------------- download ------------------------- */

// Progress receives (received, total); total is 0 when unknown.
type Progress func(received, total int64)

// DownloadToFile streams url to dest via a .part file, then renames.
// expectedSize (when > 0) is verified before the rename. onProgress may
// be nil.
func DownloadToFile(client *http.Client, url, dest string, expectedSize int64, onProgress Progress) error {
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", "Clavis-Updater")
	res, err := client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("download status %d", res.StatusCode)
	}

	part := dest + ".part"
	f, err := os.Create(part)
	if err != nil {
		return err
	}

	total := expectedSize
	if cl := res.ContentLength; cl > 0 {
		if total == 0 {
			total = cl
		}
	}

	var received int64
	buf := make([]byte, 64<<10)
	last := int64(-1)
	for {
		n, rerr := res.Body.Read(buf)
		if n > 0 {
			if _, werr := f.Write(buf[:n]); werr != nil {
				f.Close()
				os.Remove(part)
				return werr
			}
			received += int64(n)
			if onProgress != nil && (received-last >= 256<<10 || rerr == io.EOF) {
				onProgress(received, total)
				last = received
			}
		}
		if rerr == io.EOF {
			break
		}
		if rerr != nil {
			f.Close()
			os.Remove(part)
			return rerr
		}
	}
	if err := f.Close(); err != nil {
		os.Remove(part)
		return err
	}
	if onProgress != nil {
		onProgress(received, total)
	}
	if expectedSize > 0 {
		info, err := os.Stat(part)
		if err != nil {
			os.Remove(part)
			return err
		}
		if info.Size() != expectedSize {
			os.Remove(part)
			return fmt.Errorf("download incomplete: got %d of %d bytes", info.Size(), expectedSize)
		}
	}
	return os.Rename(part, dest)
}

/* ------------------------- install scripts ------------------------- */

// ScriptPath returns where the generated updater script lives for a given
// exe (next to it, so portable installs need no temp permissions).
func ScriptPath(exePath string) string {
	return filepath.Join(filepath.Dir(exePath), ".clavis-update.cmd")
}

// PortableScript builds the hand-off script: wait for the old process to
// exit, swap the exes, start the new one, clean up.
//
//	exePath — the running Clavis.exe location (becomes the new exe)
//	newExe  — downloaded artifact parked next to it (exePath + ".new")
//	oldExe  — where the previous version is parked (exePath + ".old")
func PortableScript(exePath, newExe, oldExe string) string {
	return strings.Join([]string{
		"@echo off",
		`call :waitforclavis`,
		`if exist "` + oldExe + `" del /f /q "` + oldExe + `"`,
		`move /y "` + exePath + `" "` + oldExe + `"`,
		`move /y "` + newExe + `" "` + exePath + `"`,
		`if exist "` + exePath + `" start "" "` + exePath + `"`,
		`del /f /q "%~f0"`,
		`exit /b 0`,
		`:waitforclavis`,
		`tasklist /FI "IMAGENAME eq Clavis.exe" 2>nul | find /I "Clavis.exe" >nul`,
		`if %errorlevel%==0 (timeout /t 1 /nobreak >nul & goto waitforclavis)`,
		`exit /b 0`,
	}, "\r\n")
}

// InstallerScript builds the hand-off script for the installed edition:
// wait for the old process, run the NSIS setup silently (it also kills a
// lingering Clavis itself), then relaunch from the install dir.
func InstallerScript(setupPath, targetExe string) string {
	return strings.Join([]string{
		"@echo off",
		`call :waitforclavis`,
		`start "" /wait "` + setupPath + `" /S`,
		`if exist "` + targetExe + `" start "" "` + targetExe + `"`,
		`del /f /q "` + setupPath + `"`,
		`del /f /q "%~f0"`,
		`exit /b 0`,
		`:waitforclavis`,
		`tasklist /FI "IMAGENAME eq Clavis.exe" 2>nul | find /I "Clavis.exe" >nul`,
		`if %errorlevel%==0 (timeout /t 1 /nobreak >nul & goto waitforclavis)`,
		`exit /b 0`,
	}, "\r\n")
}

// CleanupOld removes a leftover "<exe>.old" from a previous portable
// update (safe: only runs when the old image is gone).
func CleanupOld(exePath string) {
	old := OldPath(exePath)
	if _, err := os.Stat(old); err == nil {
		os.Remove(old)
	}
}

// OldPath is where the previous exe is parked during a portable swap.
func OldPath(exePath string) string {
	return exePath + ".old"
}
