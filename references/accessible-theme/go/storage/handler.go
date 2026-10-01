package storage

import (
	"encoding/json"
	"errors"
	"regexp"
	"strings"

	"github.com/glixo/extension-sdk-go/state"
)

const actionID = "save-preferences"
const storageKey = "accessible-theme/preferences/current"
var accentPattern = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

type envelope struct {
	Kind string `json:"kind"`
	ContributionID string `json:"contributionId"`
	Input json.RawMessage `json:"input"`
	Context struct { SessionID string `json:"sessionId"` } `json:"context"`
}

func Handle(requestJSON string, store state.Store) (string, error) {
	if len([]byte(requestJSON)) > 32*1024 { return "", errors.New("action_payload_too_large") }
	var request envelope
	if err := json.Unmarshal([]byte(requestJSON), &request); err != nil { return "", errors.New("action_envelope_invalid") }
	if request.Kind != "actions" || request.ContributionID != actionID { return "", errors.New("contribution_mismatch") }
	if strings.TrimSpace(request.Context.SessionID) == "" { return "", errors.New("session_context_missing") }
	var input map[string]json.RawMessage
	if err := json.Unmarshal(request.Input, &input); err != nil || len(input) != 2 { return "", errors.New("preferences_invalid") }
	for key := range input { if key != "accent" && key != "largeControls" { return "", errors.New("preferences_invalid") } }
	var accent string
	var largeControls *bool
	if json.Unmarshal(input["accent"], &accent) != nil || !accentPattern.MatchString(accent) || json.Unmarshal(input["largeControls"], &largeControls) != nil || largeControls == nil { return "", errors.New("preferences_invalid") }
	value, err := json.Marshal(map[string]any{"accent": strings.ToLower(accent), "largeControls": *largeControls})
	if err != nil { return "", errors.New("preferences_encode_failed") }
	if err := store.Set(storageKey, string(value)); err != nil { return "", err }
	return `{"accepted":true}`, nil
}
