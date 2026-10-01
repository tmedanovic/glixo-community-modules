package workspacehealth

import (
	"bytes"
	"encoding/json"
	"errors"
	"math"
	"sort"
	"strings"

	"github.com/tmedanovic/glixo-community-modules/packages/extension-sdk/go/guest"
	"github.com/tmedanovic/glixo-community-modules/packages/extension-sdk/go/workspace"
)

const maximumJSONInteger uint64 = 9_007_199_254_740_991

type fileItem struct {
	Path  string `json:"path"`
	Bytes uint64 `json:"bytes"`
}

// docs:snippet-start workspace-health-handler:go
func Handle(requestJSON string, reader workspace.Reader) (string, error) {
	if len(requestJSON) > 128*1024 {
		return "", errors.New("guest_envelope_invalid")
	}
	var envelope guest.Envelope[json.RawMessage]
	if err := json.Unmarshal([]byte(requestJSON), &envelope); err != nil {
		return "", errors.New("guest_envelope_invalid")
	}
	if envelope.Kind != "tools" || envelope.ContributionID != "inspect" {
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
	limit, err := optionalInteger(input, "maxFiles", 100, 1, 100)
	if err != nil {
		return "", err
	}
	raw, err := reader.Search(handle, "", uint32(limit))
	if err != nil {
		return "", err
	}
	items, truncated, err := readInventory(raw, limit)
	if err != nil {
		return "", err
	}
	output, err := summarize(items, truncated)
	if err != nil {
		return "", err
	}
	encoded, err := json.Marshal(output)
	if err != nil {
		return "", errors.New("guest_result_invalid")
	}
	return string(encoded), nil
}

// docs:snippet-end workspace-health-handler:go

func optionalInteger(input map[string]any, name string, fallback, minimum, maximum int) (int, error) {
	value, exists := input[name]
	if !exists {
		return fallback, nil
	}
	number, ok := value.(float64)
	if !ok || math.IsNaN(number) || math.IsInf(number, 0) || math.Trunc(number) != number || number < float64(minimum) || number > float64(maximum) {
		return 0, errors.New("input_limit_invalid")
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

func summarize(items []fileItem, truncated bool) (map[string]any, error) {
	var total uint64
	extensions := make(map[string]uint64)
	for _, item := range items {
		if item.Bytes > maximumJSONInteger-total {
			return nil, errors.New("workspace_search_result_invalid")
		}
		total += item.Bytes
		name := item.Path[strings.LastIndex(item.Path, "/")+1:]
		dot := strings.LastIndex(name, ".")
		extension := "[none]"
		if dot > 0 {
			extension = strings.ToLower(name[dot:])
		}
		extensions[extension]++
	}
	var totals any
	if !truncated {
		totals = map[string]any{"fileCount": len(items), "bytes": total}
	}
	largest := append([]fileItem(nil), items...)
	sort.Slice(largest, func(i, j int) bool {
		if largest[i].Bytes != largest[j].Bytes {
			return largest[i].Bytes > largest[j].Bytes
		}
		return bytes.Compare([]byte(largest[i].Path), []byte(largest[j].Path)) < 0
	})
	if len(largest) > 10 {
		largest = largest[:10]
	}
	largestOutput := make([]map[string]any, 0, len(largest))
	for _, item := range largest {
		largestOutput = append(largestOutput, map[string]any{"path": item.Path, "bytes": item.Bytes})
	}
	return map[string]any{
		"sampledFiles": len(items), "sampledBytes": total, "truncated": truncated,
		"eligibleFileTotals": totals, "sampledExtensions": extensions, "largestFiles": largestOutput,
	}, nil
}
