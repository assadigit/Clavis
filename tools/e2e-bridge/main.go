/**
 * CLAVIS — e2e browser bridge (dev tool, not shipped).
 *
 * Serves the browser e2e bundle (frontend/dist-e2e, built with
 * vite.e2e.config.ts) on :8093 next to a REAL Store + service dispatcher, so
 * the manager UI can be exercised in a plain browser against the same Go
 * code the desktop app runs. The store lives in a temp dir (fresh per run,
 * or per /api/reset). The Windows-only hooks (clipboard, shortcut,
 * autostart) are simulated: the clipboard seam reports success so the copy
 * flows can be verified end-to-end.
 *
 * Run:
 *
 *   cd frontend && bunx vite build --config vite.e2e.config.ts
 *   go run ./tools/e2e-bridge
 *   # open http://localhost:8093/manager.html
 */
package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sync"

	"clavis/internal/service"
	"clavis/internal/store"
)

const addr = "127.0.0.1:8093"

var (
	mu  sync.Mutex
	svc *service.Service
	dir string
)

func newService() (*service.Service, string, error) {
	d, err := os.MkdirTemp("", "clavis-e2e-*")
	if err != nil {
		return nil, "", err
	}
	st, err := store.New(d, "e2e")
	if err != nil {
		return nil, "", err
	}
	s := &service.Service{Store: st}
	/* Simulate a working clipboard so copy actions succeed in the browser
	   (the real Win32 writer is covered by the Windows e2e suite). */
	s.SetClipboardSeam(func(text string, secret bool) bool { return true })
	return s, d, nil
}

func handleState(w http.ResponseWriter, _ *http.Request) {
	mu.Lock()
	defer mu.Unlock()
	writeJSON(w, map[string]any{"result": svc.GetState()})
}

type callReq struct {
	Name string `json:"name"`
	Args []any  `json:"args"`
}

func handleCall(w http.ResponseWriter, r *http.Request) {
	var req callReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, map[string]any{"error": "bad request"})
		return
	}
	mu.Lock()
	defer mu.Unlock()
	switch req.Name {
	case "main.Clavis.GetState":
		writeJSON(w, map[string]any{"result": svc.GetState()})
	case "main.Clavis.Dispatch":
		if len(req.Args) < 2 {
			writeJSON(w, map[string]any{"error": "Dispatch needs (action, payload)"})
			return
		}
		action, _ := req.Args[0].(string)
		payload, _ := req.Args[1].(string)
		writeJSON(w, map[string]any{"result": svc.Dispatch(action, payload)})
	case "main.Clavis.ExportSave", "main.Clavis.PickImportFolder", "main.Clavis.OpenDataFolder", "main.Clavis.OpenURL":
		/* desktop-only affordances: answer as a polite no-op */
		writeJSON(w, map[string]any{"result": map[string]any{"ok": false, "canceled": true}})
	default:
		writeJSON(w, map[string]any{"result": nil})
	}
}

func handleReset(w http.ResponseWriter, _ *http.Request) {
	mu.Lock()
	defer mu.Unlock()
	if svc != nil {
		svc.Store.Close()
		_ = os.RemoveAll(dir)
	}
	next, d, err := newService()
	if err != nil {
		writeJSON(w, map[string]any{"error": err.Error()})
		return
	}
	svc, dir = next, d
	writeJSON(w, map[string]any{"result": true})
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

func main() {
	s, d, err := newService()
	if err != nil {
		log.Fatalf("e2e bridge: %v", err)
	}
	svc, dir = s, d

	dist := filepath.Join("frontend", "dist-e2e")
	if _, err := os.Stat(dist); err != nil {
		log.Fatalf("e2e bridge: %s missing — build it first:\n  cd frontend && bunx vite build --config vite.e2e.config.ts", dist)
	}
	fs := http.FileServer(http.Dir(dist))

	http.HandleFunc("/api/state", handleState)
	http.HandleFunc("/api/call", handleCall)
	http.HandleFunc("/api/reset", handleReset)
	http.Handle("/", fs)

	fmt.Printf("clavis e2e bridge: http://%s/manager.html (data: %s)\n", addr, dir)
	log.Fatal(http.ListenAndServe(addr, nil))
}
