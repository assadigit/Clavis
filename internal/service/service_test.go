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

// clipboardCall records one write through the seam.
type clipboardCall struct {
	text   string
	secret bool
}

// recordingService returns a Service whose clipboard writes are recorded
// and succeed; fail writes when fail=true.
func recordingService(t *testing.T, fail bool) (*Service, *[]clipboardCall) {
	t.Helper()
	st, err := store.New(t.TempDir(), "test")
	if err != nil {
		t.Fatal(err)
	}
	calls := &[]clipboardCall{}
	return &Service{
		Store: st,
		writeClipboard: func(text string, secret bool) bool {
			*calls = append(*calls, clipboardCall{text: text, secret: secret})
			return !fail
		},
	}, calls
}

// TestCopyActionWritesClipboardInBackend pins the NEW copy contract
// (SPEC §5.2): the backend writes the clipboard itself with the store's
// privacy verdict, and the response carries metadata only — the value must
// never cross to the UI.
func TestCopyActionWritesClipboardInBackend(t *testing.T) {
	s, calls := recordingService(t, false)
	secretID := mustCreateItem(t, s, "GitHub token", "ghp_supersecret", true)
	plainID := mustCreateItem(t, s, "Greeting", "hello world", false)

	res := dispatchJSON(t, s, "copy", `{"kind":"item","id":"`+secretID+`"}`)
	if res["ok"] != true || res["copied"] != true {
		t.Fatalf("secret item copy failed: ok=%v copied=%v err=%v", res["ok"], res["copied"], res["error"])
	}
	if res["containsSecret"] != true {
		t.Fatalf("secret item: containsSecret = %v, want true", res["containsSecret"])
	}
	if _, leaked := res["text"]; leaked {
		t.Fatal("copy response must not carry the value to the UI")
	}
	if len(*calls) != 1 || (*calls)[0].text != "ghp_supersecret" || !(*calls)[0].secret {
		t.Fatalf("clipboard write = %+v, want ghp_supersecret with privacy flag", *calls)
	}

	res = dispatchJSON(t, s, "copy", `{"kind":"item","id":"`+plainID+`"}`)
	if res["copied"] != true || res["containsSecret"] != false {
		t.Fatalf("plain item copy: copied=%v containsSecret=%v", res["copied"], res["containsSecret"])
	}
	if len(*calls) != 2 || (*calls)[1].secret {
		t.Fatalf("plain item must not set privacy formats: %+v", *calls)
	}
}

// TestCopyActionGroupCarriesPrivacyWhenAnyMemberSecret pins §5.2 for
// groups: the KEY=value block is excluded from clipboard history whenever
// ANY member is a secret — the rule the group editor used to miss.
func TestCopyActionGroupCarriesPrivacyWhenAnyMemberSecret(t *testing.T) {
	s, calls := recordingService(t, false)
	secretID := mustCreateItem(t, s, "GitHub token", "ghp_supersecret", true)
	plainID := mustCreateItem(t, s, "Greeting", "hello world", false)
	groupID := mustCreateGroup(t, s, "project", secretID, plainID)

	res := dispatchJSON(t, s, "copy", `{"kind":"group","id":"`+groupID+`"}`)
	if res["ok"] != true || res["copied"] != true {
		t.Fatalf("group copy failed: %v", res["error"])
	}
	if res["containsSecret"] != true {
		t.Fatalf("group with a secret member: containsSecret = %v, want true", res["containsSecret"])
	}
	if got, ok := res["lineCount"].(int); !ok || got != 2 {
		t.Fatalf("group lineCount = %v (%T), want 2", res["lineCount"], res["lineCount"])
	}
	if len(*calls) != 1 {
		t.Fatalf("expected exactly one clipboard write, got %d", len(*calls))
	}
	call := (*calls)[0]
	if !call.secret {
		t.Fatal("group with a secret member must set the privacy formats")
	}
	for _, want := range []string{"GITHUB_TOKEN=ghp_supersecret", "GREETING=hello world"} {
		if !strings.Contains(call.text, want) {
			t.Fatalf("group block %q missing %q", call.text, want)
		}
	}

	plainOnly := mustCreateGroup(t, s, "plain group", plainID)
	res = dispatchJSON(t, s, "copy", `{"kind":"group","id":"`+plainOnly+`"}`)
	if res["containsSecret"] != false || (*calls)[1].secret {
		t.Fatalf("plain group must not set privacy formats: res=%v calls=%+v", res["containsSecret"], *calls)
	}
}

func TestCopyActionClipboardFailureIsReported(t *testing.T) {
	s, _ := recordingService(t, true)
	id := mustCreateItem(t, s, "Token", "value", true)
	res := dispatchJSON(t, s, "copy", `{"kind":"item","id":"`+id+`"}`)
	if res["ok"] != true {
		t.Fatalf("copy should still be ok (the store update succeeded): %v", res)
	}
	if res["copied"] != false {
		t.Fatalf("failed clipboard write must report copied=false, got %v", res["copied"])
	}
}

func TestCopyActionUnknownEntry(t *testing.T) {
	s := newTestService(t)
	res := dispatchJSON(t, s, "copy", `{"kind":"item","id":"missing"}`)
	if res["ok"] != false {
		t.Fatalf("unknown entry must fail, got %v", res)
	}
	if _, has := res["state"]; has {
		t.Fatal("failed copy should not refresh state")
	}
}
