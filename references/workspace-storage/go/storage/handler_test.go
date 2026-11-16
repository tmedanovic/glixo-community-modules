package storage

import (
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"
)

type memoryState map[string]string
func (s memoryState) Get(key string) (string, bool, error) { value, ok := s[key]; return value, ok, nil }
func (s memoryState) Set(key, value string) error { s[key] = value; return nil }
func (s memoryState) List(prefix string) ([]string, error) { out := []string{}; for key := range s { if strings.HasPrefix(key, prefix) { out = append(out, key) } }; return out, nil }
func (s memoryState) Delete(key string) (bool, error) { _, ok := s[key]; delete(s, key); return ok, nil }

func TestNamespaceRoundTrip(t *testing.T) {
	state := memoryState{"workspace-storage/test/zeta": "x", "other/test/hidden": "y"}
	request := `{"kind":"tools","contributionId":"storage","input":{"operation":"set","key":"alpha","value":"green"}}`
	if _, err := Handle(request, state); err != nil { t.Fatal(err) }
	if state["workspace-storage/test/alpha"] != "green" { t.Fatal("write escaped or missed namespace") }
	response, err := Handle(`{"kind":"tools","contributionId":"storage","input":{"operation":"list","prefix":""}}`, state)
	if err != nil { t.Fatal(err) }
	var decoded struct { Keys []string `json:"keys"` }; if err := json.Unmarshal([]byte(response), &decoded); err != nil { t.Fatal(err) }
	if !reflect.DeepEqual(decoded.Keys, []string{"alpha", "zeta"}) { t.Fatalf("unexpected keys: %#v", decoded.Keys) }
}

func TestInvalidInputCannotEscapeOrExceedBound(t *testing.T) {
	state := memoryState{}
	for _, key := range []string{"../outside", "nested/key", "", ".", ".."} {
		_, err := Handle(`{"kind":"tools","contributionId":"storage","input":{"operation":"get","key":"`+key+`"}}`, state)
		if err == nil || err.Error() != "storage_key_invalid" { t.Fatalf("key %q accepted: %v", key, err) }
	}
	_, err := Handle(`{"kind":"tools","contributionId":"storage","input":{"operation":"set","key":"large","value":"`+strings.Repeat("x", 4097)+`"}}`, state)
	if err == nil || err.Error() != "value_too_large" { t.Fatalf("unbounded value accepted: %v", err) }
	if len(state) != 0 { t.Fatalf("invalid writes mutated state: %#v", state) }
}
