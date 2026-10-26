/**
 * CLAVIS — dispatcher characterization tests.
 *
 * These pin the moved dispatch surface (internal/service) right after the
 * extraction from app.go, so the move is provably behavior-neutral. The
 * copy contract is then changed deliberately in the backend-copy commit,
 * which updates these tests red → green.
 */
package service

import (
	"fmt"
	"strings"
	"testing"

	"clavis/internal/store"
)

func newTestService(t *testing.T) *Service {
	t.Helper()
	st, err := store.New(t.TempDir(), "test")
	if err != nil {
		t.Fatal(err)
	}
	return &Service{Store: st}
}

func dispatchJSON(t *testing.T, s *Service, action, payload string) map[string]any {
	t.Helper()
	res := s.Dispatch(action, payload)
	if res == nil {
		t.Fatalf("dispatch %q returned nil", action)
	}
	return res
}

func mustCreateItem(t *testing.T, s *Service, name, value string, isSecret bool) string {
	t.Helper()
	payload := fmt.Sprintf(`{"input":{"name":%q,"value":%q,"isSecret":%v}}`, name, value, isSecret)
	res := dispatchJSON(t, s, "createItem", payload)
	id, _ := res["id"].(string)
	if res["ok"] != true || id == "" {
		t.Fatalf("createItem %q failed: %v", name, res["error"])
	}
	return id
}

func mustCreateGroup(t *testing.T, s *Service, name string, itemIDs ...string) string {
	t.Helper()
	ids := strings.Join(itemIDs, `","`)
	payload := fmt.Sprintf(`{"input":{"name":%q,"itemIds":["%s"]}}`, name, ids)
	res := dispatchJSON(t, s, "createGroup", payload)
	id, _ := res["id"].(string)
	if res["ok"] != true || id == "" {
		t.Fatalf("createGroup %q failed: %v", name, res["error"])
	}
	return id
}

func TestDispatchInvalidPayload(t *testing.T) {
	s := newTestService(t)
	if res := dispatchJSON(t, s, "copy", "{not json"); res["ok"] != false {
		t.Fatalf("invalid JSON must fail, got %v", res)
	}
	if res := dispatchJSON(t, s, "noSuchAction", `{}`); res["ok"] != false {
		t.Fatalf("unknown action must fail, got %v", res)
	}
}

// TestDispatchPassthroughActions pins the dispatcher's store wiring for the
// main CRUD path (create → update → delete → undo).
func TestDispatchPassthroughActions(t *testing.T) {
	s := newTestService(t)
	id := mustCreateItem(t, s, "GitHub token", "v1", true)

	res := dispatchJSON(t, s, "updateItem", `{"id":"`+id+`","patch":{"value":"v2"}}`)
	if res["ok"] != true {
		t.Fatalf("updateItem failed: %v", res["error"])
	}
	st := s.Store.State()
	if got := st.Data.Items[0].Value; got != "v2" {
		t.Fatalf("updateItem did not apply: value = %q", got)
	}

	res = dispatchJSON(t, s, "deleteEntry", `{"kind":"item","id":"`+id+`"}`)
	token, _ := res["undoToken"].(string)
	if res["ok"] != true || token == "" {
		t.Fatalf("deleteEntry failed: %v", res["error"])
	}
	if s.Store.State().Data.Items[0].DeletedAt == nil {
		t.Fatal("deleteEntry did not soft-delete")
	}

	res = dispatchJSON(t, s, "undoDelete", `{"undoToken":"`+token+`"}`)
	if res["ok"] != true {
		t.Fatalf("undoDelete failed: %v", res["error"])
	}
	if s.Store.State().Data.Items[0].DeletedAt != nil {
		t.Fatal("undoDelete did not restore")
	}

	// The state envelope (GetState) carries the store snapshot + flag.
	env := s.GetState()
	if env.Data.Items[0].Name != "GitHub token" || env.AppVersion != "test" {
		t.Fatalf("GetState envelope wrong: %+v", env.Data.Items[0])
	}
}

// TestCopyActionContract pins the copy action's CURRENT (pre-fix) response
// shape. The backend-copy commit deliberately changes this contract — that
// commit updates this test first (red), then the implementation (green).
func TestCopyActionContract(t *testing.T) {
	s := newTestService(t)
	id := mustCreateItem(t, s, "GitHub token", "ghp_x", true)
	res := dispatchJSON(t, s, "copy", `{"kind":"item","id":"`+id+`"}`)
	if res["ok"] != true {
		t.Fatalf("copy failed: %v", res["error"])
	}
	if res["text"] != "ghp_x" {
		t.Fatalf("old contract: copy returns the text, got %v", res["text"])
	}
	if res["containsSecret"] != true {
		t.Fatalf("containsSecret = %v, want true", res["containsSecret"])
	}
}
