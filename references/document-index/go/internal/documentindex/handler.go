package documentindex

import (
	"bytes"
	"encoding/json"
	"errors"
	"math"
	"sort"
	"strings"
	"unicode/utf16"
	"unicode/utf8"

	"github.com/glixo/extension-sdk-go/guest"
	"github.com/glixo/extension-sdk-go/workspace"
)

const (
	maximumReadBytes    = 4096
	maximumExcerptBytes = 96
	maximumJSONInteger  = uint64(9_007_199_254_740_991)
)

type fileItem struct {
	Path  string `json:"path"`
	Bytes uint64 `json:"bytes"`
}

// docs:snippet-start document-index-handler:go
func Handle(requestJSON string, reader workspace.Reader) (string, error) {
	if len(requestJSON) > 128*1024 {
		return "", errors.New("guest_envelope_invalid")
	}
	var envelope guest.Envelope[json.RawMessage]
	if err := json.Unmarshal([]byte(requestJSON), &envelope); err != nil {
		return "", errors.New("guest_envelope_invalid")
	}
	if envelope.Kind != "dataSources" || envelope.ContributionID != "search" {
		return "", errors.New("contribution_mismatch")
	}
	handle, hasHandle := envelope.Context.ResourceHandles["workspace"]
	if !hasHandle || strings.TrimSpace(handle) == "" || strings.TrimSpace(envelope.Context.SessionID) == "" {
		return "", errors.New("workspace_handle_missing")
	}
	input, ok := envelope.Input.(map[string]any)
	if !ok {
		return "", errors.New("input_invalid")
	}
	query, ok := input["query"].(string)
	if !ok || strings.TrimSpace(query) == "" || utf16Length(query) > 128 {
		return "", errors.New("query_invalid")
	}
	limit, err := optionalInteger(input, "limit", 10, 1, 20, "result_limit_invalid")
	if err != nil {
		return "", err
	}
	excerptLimit, err := optionalInteger(input, "excerptBytes", maximumExcerptBytes, 1, maximumExcerptBytes, "excerpt_limit_invalid")
	if err != nil {
		return "", err
	}
	raw, err := reader.Search(handle, query, uint32(limit))
	if err != nil {
		return "", err
	}
	items, truncated, err := readInventory(raw, limit)
	if err != nil {
		return "", err
	}
	results := make([]map[string]any, 0, len(items))
	for _, item := range items {
		var excerpt any
		excerptTruncated := false
		if item.Bytes > maximumReadBytes {
			excerpt = nil
			excerptTruncated = true
		} else {
			content, err := reader.Read(handle, item.Path, maximumReadBytes)
			if err != nil {
				return "", err
			}
			if !utf8.ValidString(content) || len([]byte(content)) > maximumReadBytes {
				return "", errors.New("workspace_read_result_invalid")
			}
			contentBytes := []byte(content)
			end := min(excerptLimit, len(contentBytes))
			for end > 0 && !utf8.Valid(contentBytes[:end]) {
				end--
			}
			excerpt = string(contentBytes[:end])
			excerptTruncated = len(contentBytes) > excerptLimit
		}
		results = append(results, map[string]any{
			"path": item.Path, "bytes": item.Bytes, "excerpt": excerpt, "excerptTruncated": excerptTruncated,
		})
	}
	encoded, err := json.Marshal(map[string]any{"query": query, "items": results, "truncated": truncated})
	if err != nil {
		return "", errors.New("guest_result_invalid")
	}
	return string(encoded), nil
}

// docs:snippet-end document-index-handler:go

func optionalInteger(input map[string]any, name string, fallback, minimum, maximum int, errorCode string) (int, error) {
	value, exists := input[name]
	if !exists {
		return fallback, nil
	}
	number, ok := value.(float64)
	if !ok || math.IsNaN(number) || math.IsInf(number, 0) || math.Trunc(number) != number || number < float64(minimum) || number > float64(maximum) {
		return 0, errors.New(errorCode)
	}
	return int(number), nil
}

func readInventory(raw string, limit int) ([]fileItem, bool, error) {
	var root map[string]json.RawMessage
	if err := json.Unmarshal([]byte(raw), &root); err != nil || root == nil {
		return nil, false, errors.New("workspace_search_result_invalid")
	}
	itemsJSON, exists := root["items"]
	if !exists {
		return nil, false, errors.New("workspace_search_result_invalid")
	}
	var rawItems []json.RawMessage
	if err := json.Unmarshal(itemsJSON, &rawItems); err != nil || rawItems == nil || len(rawItems) > limit {
		return nil, false, errors.New("workspace_search_result_invalid")
	}
	items := make([]fileItem, 0, len(rawItems))
	for _, rawItem := range rawItems {
		var fields map[string]json.RawMessage
		if err := json.Unmarshal(rawItem, &fields); err != nil || fields == nil {
			return nil, false, errors.New("workspace_search_item_invalid")
		}
		var item fileItem
		pathJSON, hasPath := fields["path"]
		bytesJSON, hasBytes := fields["bytes"]
		if !hasPath || !hasBytes || json.Unmarshal(pathJSON, &item.Path) != nil || item.Path == "" {
			return nil, false, errors.New("workspace_search_item_invalid")
		}
		var exactBytes string
		if err := json.Unmarshal(bytesJSON, &exactBytes); err == nil {
			return nil, false, errors.New("workspace_search_item_invalid")
		}
		if err := json.Unmarshal(bytesJSON, &item.Bytes); err != nil || item.Bytes > maximumJSONInteger {
			return nil, false, errors.New("workspace_search_item_invalid")
		}
		items = append(items, item)
	}
	truncatedJSON, exists := root["truncated"]
	if !exists || (string(truncatedJSON) != "true" && string(truncatedJSON) != "false") {
		return nil, false, errors.New("workspace_search_result_invalid")
	}
	var truncated bool
	if err := json.Unmarshal(truncatedJSON, &truncated); err != nil {
		return nil, false, errors.New("workspace_search_result_invalid")
	}
	seen := make(map[string]struct{}, len(items))
	for _, item := range items {
		if !validPath(item.Path) || item.Bytes > maximumJSONInteger {
			return nil, false, errors.New("workspace_search_item_invalid")
		}
		if _, duplicate := seen[item.Path]; duplicate {
			return nil, false, errors.New("workspace_search_item_invalid")
		}
		seen[item.Path] = struct{}{}
	}
	sort.Slice(items, func(i, j int) bool { return bytes.Compare([]byte(items[i].Path), []byte(items[j].Path)) < 0 })
	return items, truncated, nil
}

func validPath(path string) bool {
	if path == "" || strings.HasPrefix(path, "/") || strings.ContainsAny(path, "\\:") {
		return false
	}
	for _, segment := range strings.Split(path, "/") {
		if segment == "" || segment == "." || segment == ".." {
			return false
		}
	}
	return true
}

func utf16Length(value string) int { return len(utf16.Encode([]rune(value))) }
