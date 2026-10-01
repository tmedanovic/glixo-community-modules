package storage

import (
	"testing"
	"github.com/glixo/extension-sdk-go/state"
)

type memoryState map[string]string
func (s memoryState) Get(key string) (string, bool, error) { value, ok := s[key]; return value, ok, nil }
func (s memoryState) Set(key, value string) error { s[key] = value; return nil }
func (s memoryState) List(prefix string) ([]string, error) { return nil, nil }
func (s memoryState) Delete(key string) (bool, error) { _, ok := s[key]; delete(s,key); return ok, nil }
var _ state.Store = memoryState{}

func TestActionPersistsValidatedPreference(t *testing.T) {
	state := memoryState{}
	request := `{"kind":"actions","contributionId":"save-preferences","input":{"accent":"#10B981","largeControls":true},"context":{"sessionId":"contribution:save-preferences"}}`
	got, err := Handle(request, state)
	if err != nil || got != `{"accepted":true}` { t.Fatalf("Handle() = %q, %v", got, err) }
	if state[storageKey] != `{"accent":"#10b981","largeControls":true}` { t.Fatalf("stored value = %q", state[storageKey]) }
}

func TestInvalidPreferenceDoesNotWrite(t *testing.T) {
	state := memoryState{}
	request := `{"kind":"actions","contributionId":"save-preferences","input":{"accent":"url(#bad)","largeControls":true},"context":{"sessionId":"contribution:save-preferences"}}`
	if _, err := Handle(request, state); err == nil { t.Fatal("invalid accent was accepted") }
	if len(state) != 0 { t.Fatalf("invalid input wrote state: %#v", state) }
}
