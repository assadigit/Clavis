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
	"encoding/json"
	"fmt"
	"reflect"
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
	if env.UIState.Items[0].Name != "GitHub token" || env.AppVersion != "test" {
		t.Fatalf("GetState envelope wrong: %+v", env.UIState.Items[0])
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
		t.Fatalf("copy should still be ok (entry found, payload prepared): %v", res)
	}
	if res["copied"] != false {
		t.Fatalf("failed clipboard write must report copied=false, got %v", res["copied"])
	}
}

// useCountOf reads an item's useCount out of a dispatch response's state map.
func useCountOf(t *testing.T, res map[string]any, id string) float64 {
	t.Helper()
	st, _ := res["state"].(map[string]any)
	data, _ := st["data"].(map[string]any)
	items, _ := data["items"].([]any)
	for _, x := range items {
		it, _ := x.(map[string]any)
		if it["id"] == id {
			n, _ := it["useCount"].(float64)
			return n
		}
	}
	t.Fatalf("item %q not found in response state", id)
	return 0
}

// groupUseCountOf reads a group's useCount out of a dispatch response.
func groupUseCountOf(t *testing.T, res map[string]any, id string) float64 {
	t.Helper()
	st, _ := res["state"].(map[string]any)
	data, _ := st["data"].(map[string]any)
	groups, _ := data["groups"].([]any)
	for _, x := range groups {
		g, _ := x.(map[string]any)
		if g["id"] == id {
			n, _ := g["useCount"].(float64)
			return n
		}
	}
	t.Fatalf("group %q not found in response state", id)
	return 0
}

// TestCopyActionMarksUsedOnlyOnClipboardSuccess pins the used-counter fix:
// useCount/lastUsedAt track SUCCESSFUL copies, not intents — a failed
// clipboard write must leave them untouched, a successful one bumps exactly
// once, and the refreshed response state reflects it.
func TestCopyActionMarksUsedOnlyOnClipboardSuccess(t *testing.T) {
	s, _ := recordingService(t, true) // clipboard writes fail
	id := mustCreateItem(t, s, "Token", "value", true)
	gid := mustCreateGroup(t, s, "g", id)

	res := dispatchJSON(t, s, "copy", `{"kind":"item","id":"`+id+`"}`)
	if res["copied"] != false {
		t.Fatalf("failed write must report copied=false, got %v", res["copied"])
	}
	if n := useCountOf(t, res, id); n != 0 {
		t.Fatalf("failed clipboard write bumped useCount to %v, want 0", n)
	}
	for _, it := range s.Store.State().Data.Items {
		if it.ID == id && (it.UseCount != 0 || it.LastUsedAt != nil) {
			t.Fatal("failed clipboard write must not touch the store's use stats")
		}
	}

	res = dispatchJSON(t, s, "copy", `{"kind":"group","id":"`+gid+`"}`)
	if res["copied"] != false {
		t.Fatalf("failed group write must report copied=false, got %v", res["copied"])
	}
	if n := groupUseCountOf(t, res, gid); n != 0 {
		t.Fatalf("failed group write bumped useCount to %v, want 0", n)
	}

	ok, _ := recordingService(t, false) // clipboard writes succeed
	oid := mustCreateItem(t, ok, "Token", "value", true)
	res = dispatchJSON(t, ok, "copy", `{"kind":"item","id":"`+oid+`"}`)
	if res["copied"] != true {
		t.Fatalf("copy failed: %v", res["error"])
	}
	if n := useCountOf(t, res, oid); n != 1 {
		t.Fatalf("successful copy useCount = %v, want 1", n)
	}
	for _, it := range ok.Store.State().Data.Items {
		if it.ID == oid && (it.UseCount != 1 || it.LastUsedAt == nil) {
			t.Fatal("successful copy must set useCount=1 and lastUsedAt")
		}
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

// --- state redaction (SPEC §5.2: the UI gets masked previews, not values) ---

func stateJSON(t *testing.T, s *Service) string {
	t.Helper()
	b, err := json.Marshal(s.GetState())
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func TestGetStateRedactsValues(t *testing.T) {
	s := newTestService(t)
	long := mustCreateItem(t, s, "GitHub token", "ghp_supersecretvalue", true)
	short := mustCreateItem(t, s, "Pin", "1234", true) // < 12 units: no last4
	plain := mustCreateItem(t, s, "Greeting", "hello world", false)

	_ = long
	_ = short
	_ = plain

	blob := stateJSON(t, s)
	for _, secret := range []string{"ghp_supersecretvalue", "hello world", "1234"} {
		if strings.Contains(blob, secret) {
			t.Fatalf("GetState leaked value %q to the UI", secret)
		}
	}
	if !strings.Contains(blob, `"valueLast4":"alue"`) {
		t.Fatalf("long secret should expose last 4 chars (showLast4 default on), got: %s", blob)
	}

	env := s.GetState()
	for _, it := range env.UIState.Items {
		if it.Value != "" {
			t.Fatalf("redacted item still carries a value: %+v", it)
		}
	}

	// showLast4 off → no last4 anywhere.
	if res := dispatchJSON(t, s, "updateSettings", `{"patch":{"showLast4":false}}`); res["ok"] != true {
		t.Fatalf("updateSettings failed: %v", res["error"])
	}
	blob = stateJSON(t, s)
	if strings.Contains(blob, `"valueLast4"`) {
		t.Fatalf("showLast4=false must clear valueLast4, got: %s", blob)
	}
}

// TestDispatchResponsesCarryRedactedState: every done() response embeds the
// state snapshot, so a mutation response must never leak values either.
func TestDispatchResponsesCarryRedactedState(t *testing.T) {
	s, calls := recordingService(t, false)
	id := mustCreateItem(t, s, "GitHub token", "ghp_supersecretvalue", true)
	_ = id
	res := dispatchJSON(t, s, "copy", `{"kind":"item","id":"`+id+`"}`)
	if res["ok"] != true || res["copied"] != true {
		t.Fatalf("copy failed: %v", res)
	}
	blob, err := json.Marshal(res)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(blob), "ghp_supersecretvalue") {
		t.Fatal("dispatch response leaked the value through the state snapshot")
	}
	if len(*calls) == 0 || !(*calls)[0].secret {
		t.Fatalf("clipboard seam calls = %+v", *calls)
	}
}

// TestGetValueAction: the edit form fetches exactly one value on demand.
func TestGetValueAction(t *testing.T) {
	s := newTestService(t)
	id := mustCreateItem(t, s, "GitHub token", "ghp_thevalue", true)

	res := dispatchJSON(t, s, "getValue", `{"id":"`+id+`"}`)
	if res["ok"] != true || res["value"] != "ghp_thevalue" {
		t.Fatalf("getValue = %v / %v", res["ok"], res["value"])
	}
	if _, has := res["state"]; has {
		t.Fatal("getValue should not refresh state")
	}

	if res := dispatchJSON(t, s, "getValue", `{"id":"missing"}`); res["ok"] != false {
		t.Fatalf("getValue for a missing item must fail, got %v", res)
	}
}

// withTransparency swaps the osTransparency seam for the duration of f.
func withTransparency(t *testing.T, v bool, f func()) {
	t.Helper()
	old := osTransparency
	osTransparency = func() bool { return v }
	defer func() { osTransparency = old }()
	f()
}

// TestStateMapMemoizedUntilTheStoreChanges pins the stateMap fix: the full
// snapshot is re-serialized only when the store version or the OS
// transparency flag changes — not on every dispatched action — and the
// memoized path stays redacted.
func TestStateMapMemoizedUntilTheStoreChanges(t *testing.T) {
	s := newTestService(t)
	mustCreateItem(t, s, "GitHub token", "ghp_secretvalue", true)

	m1 := s.stateMap()
	m2 := s.stateMap()
	if m1 == nil || len(m1) == 0 {
		t.Fatal("stateMap returned an empty snapshot")
	}
	if reflect.ValueOf(m1).Pointer() != reflect.ValueOf(m2).Pointer() {
		t.Fatal("stateMap must reuse the memoized snapshot while the store is unchanged")
	}

	// A mutation invalidates the memo; the new snapshot carries the change
	// and still leaks no values.
	mustCreateItem(t, s, "Pin", "123456789012", true)
	m3 := s.stateMap()
	if reflect.ValueOf(m3).Pointer() == reflect.ValueOf(m2).Pointer() {
		t.Fatal("stateMap must re-serialize after a store change")
	}
	blob, err := json.Marshal(m3)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(blob), `"name":"Pin"`) {
		t.Fatal("the refreshed snapshot must include the new item")
	}
	for _, secret := range []string{"ghp_secretvalue", "123456789012"} {
		if strings.Contains(string(blob), secret) {
			t.Fatalf("memoized snapshot leaked value %q", secret)
		}
	}

	// The OS transparency flag is part of the cache key.
	withTransparency(t, false, func() {
		m4 := s.stateMap()
		if reflect.ValueOf(m4).Pointer() == reflect.ValueOf(m3).Pointer() {
			t.Fatal("stateMap must re-serialize when the OS transparency flag changes")
		}
	})
}
