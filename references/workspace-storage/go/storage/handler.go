package storage

import (
	"encoding/json"
	"errors"
	"sort"
	"strings"
	"unicode/utf8"

	"github.com/tmedanovic/glixo-community-modules/packages/extension-sdk/go/state"
)

const (
	ContributionID = "storage"
	TestPrefix = "workspace-storage/test/"
	MaxValueBytes = 4096
)

type Envelope struct {
	Kind string `json:"kind"`
	ContributionID string `json:"contributionId"`
	Input json.RawMessage `json:"input"`
}
func validKey(value string) bool {
	if len(value) == 0 || len(value) > 64 || !utf8.ValidString(value) { return false }
	for i, ch := range value {
		if i == 0 {
			if !(ch >= 'a' && ch <= 'z') && !(ch >= '0' && ch <= '9') { return false }
		} else if !(ch >= 'a' && ch <= 'z') && !(ch >= '0' && ch <= '9') && !strings.ContainsRune("._-", ch) { return false }
	}
	return true
}
func storageKey(value string) (string, error) {
	if !validKey(value) { return "", errors.New("storage_key_invalid") }
	return TestPrefix + value, nil
}

// docs:snippet-start workspace-storage-handler:go
func Handle(requestJSON string, store state.Store) (string, error) {
	var envelope Envelope
	if err := json.Unmarshal([]byte(requestJSON), &envelope); err != nil { return "", errors.New("request_json_invalid") }
	if envelope.Kind != "tools" || envelope.ContributionID != ContributionID { return "", errors.New("contribution_mismatch") }
	var input map[string]json.RawMessage
	if err := json.Unmarshal(envelope.Input, &input); err != nil || input == nil { return "", errors.New("input_object_required") }
	var operation string
	if json.Unmarshal(input["operation"], &operation) != nil { return "", errors.New("storage_operation_invalid") }
	readString := func(name string) (string, bool) {
		var value string
		if json.Unmarshal(input[name], &value) != nil { return "", false }
		return value, true
	}
	ensureOnly := func(names ...string) bool {
		allowed := map[string]bool{"operation": true}
		for _, name := range names { allowed[name] = true }
		for name := range input { if !allowed[name] { return false } }
		return true
	}
	var response map[string]any
	switch operation {
	case "get":
		if !ensureOnly("key") { return "", errors.New("storage_input_invalid") }
		keyValue, ok := readString("key"); if !ok { return "", errors.New("storage_key_invalid") }
		key, err := storageKey(keyValue); if err != nil { return "", err }
		value, exists, err := store.Get(key); if err != nil { return "", err }
		var result any; if exists { result = value }
		response = map[string]any{"operation": operation, "key": keyValue, "value": result}
	case "set":
		if !ensureOnly("key", "value") { return "", errors.New("storage_input_invalid") }
		keyValue, ok := readString("key"); if !ok { return "", errors.New("storage_key_invalid") }
		value, ok := readString("value"); if !ok { return "", errors.New("value_string_required") }
		if len([]byte(value)) > MaxValueBytes { return "", errors.New("value_too_large") }
		key, err := storageKey(keyValue); if err != nil { return "", err }
		if err := store.Set(key, value); err != nil { return "", err }
		response = map[string]any{"operation": operation, "key": keyValue, "stored": true}
	case "list":
		if !ensureOnly("prefix") { return "", errors.New("storage_input_invalid") }
		prefix, ok := readString("prefix"); if !ok { if input["prefix"] != nil { return "", errors.New("key_prefix_invalid") }; prefix = "" }
		fullPrefix := TestPrefix
		if prefix != "" { var err error; fullPrefix, err = storageKey(prefix); if err != nil { return "", errors.New("key_prefix_invalid") } }
		all, err := store.List(fullPrefix); if err != nil { return "", err }
		keys := make([]string, 0, len(all))
		for _, key := range all {
			if strings.HasPrefix(key, TestPrefix) { logical := strings.TrimPrefix(key, TestPrefix); if validKey(logical) && strings.HasPrefix(logical, prefix) { keys = append(keys, logical) } }
		}
		sort.Strings(keys); if len(keys) > 100 { keys = keys[:100] }
		response = map[string]any{"operation": operation, "prefix": prefix, "keys": keys}
	case "delete":
		if !ensureOnly("key") { return "", errors.New("storage_input_invalid") }
		keyValue, ok := readString("key"); if !ok { return "", errors.New("storage_key_invalid") }
		key, err := storageKey(keyValue); if err != nil { return "", err }
		deleted, err := store.Delete(key); if err != nil { return "", err }
		response = map[string]any{"operation": operation, "key": keyValue, "deleted": deleted}
	default:
		return "", errors.New("storage_operation_invalid")
	}
	encoded, err := json.Marshal(response); if err != nil { return "", errors.New("response_json_invalid") }
	return string(encoded), nil
}
// docs:snippet-end workspace-storage-handler:go
