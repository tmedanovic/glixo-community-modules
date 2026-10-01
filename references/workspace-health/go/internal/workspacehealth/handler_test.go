package workspacehealth

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"testing"

	"github.com/glixo/extension-sdk-go/workspace"
)

type fakeWorkspace struct {
	searchResult string
	searchCalls  []searchCall
}

type searchCall struct {
	handle string
	query  string
	limit  uint32
}

func (f *fakeWorkspace) Search(handle, query string, limit uint32) (string, error) {
	f.searchCalls = append(f.searchCalls, searchCall{handle, query, limit})
	return f.searchResult, nil
}

func (f *fakeWorkspace) Read(string, string, uint32) (string, error) {
	panic("health observer must not read content")
}

var _ workspace.Reader = (*fakeWorkspace)(nil)

func encode(t *testing.T, value any) string {
	t.Helper()
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

func fixturePath(t *testing.T, relative string) string {
	t.Helper()
	_, source, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("test source path unavailable")
	}
	return filepath.Clean(filepath.Join(filepath.Dir(source), "..", "..", "..", "..", "_shared", "goldens", relative))
}

func withSession(t *testing.T, raw string) string {
	t.Helper()
	var envelope map[string]any
	if err := json.Unmarshal([]byte(raw), &envelope); err != nil {
		t.Fatal(err)
	}
	context := envelope["context"].(map[string]any)
	context["sessionId"] = "test-session"
	return encode(t, envelope)
}

func TestGoldenPartialSampleMatchesBoundedOutput(t *testing.T) {
	var fixture map[string]json.RawMessage
	data, err := os.ReadFile(fixturePath(t, filepath.Join("workspace-health", "partial-sample.json")))
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(data, &fixture); err != nil {
		t.Fatal(err)
	}
	var request map[string]any
	if err := json.Unmarshal(fixture["request"], &request); err != nil {
		t.Fatal(err)
	}
	reader := &fakeWorkspace{searchResult: string(fixture["hostSearchResult"])}
	actual, err := Handle(withSession(t, encode(t, request)), reader)
	if err != nil {
		t.Fatal(err)
	}
	var actualValue, expectedValue any
	if err := json.Unmarshal([]byte(actual), &actualValue); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(fixture["expectedResponse"], &expectedValue); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(actualValue, expectedValue) {
		t.Fatalf("golden mismatch\nactual:   %s\nexpected: %s", actual, fixture["expectedResponse"])
	}
	if !reflect.DeepEqual(reader.searchCalls, []searchCall{{handle: "host-issued", query: "", limit: 2}}) {
		t.Fatalf("unexpected bounded handle/query/limit: %#v", reader.searchCalls)
	}
}

func TestCompleteInventoryAndUTF8ByteOrdinalOrder(t *testing.T) {
	items, truncated, err := readInventory(encode(t, map[string]any{"items": []any{
		map[string]any{"path": "𐀀.txt", "bytes": 5}, map[string]any{"path": "\uE000.txt", "bytes": 5}, map[string]any{"path": "z/no-extension", "bytes": 1},
	}, "truncated": false}), 3)
	if err != nil || truncated {
		t.Fatalf("read inventory: truncated=%v err=%v", truncated, err)
	}
	result, err := summarize(items, truncated)
	if err != nil {
		t.Fatal(err)
	}
	value := result["eligibleFileTotals"].(map[string]any)
	if value["fileCount"] != 3 || value["bytes"] != uint64(11) {
		t.Fatalf("complete totals not preserved: %#v", value)
	}
	largest := result["largestFiles"].([]map[string]any)
	if largest[0]["path"] != "\uE000.txt" || largest[1]["path"] != "𐀀.txt" {
		t.Fatalf("unexpected UTF-8 byte ordinal tie order: %#v", largest)
	}
	if result["sampledExtensions"].(map[string]uint64)["[none]"] != 1 {
		t.Fatalf("unexpected extension summary: %#v", result["sampledExtensions"])
	}
}

func TestRejectsMissingHandleInvalidBoundsMalformedItemsAndUnsafeIntegers(t *testing.T) {
	reader := &fakeWorkspace{searchResult: encode(t, map[string]any{"items": []any{}, "truncated": false})}
	for _, request := range []map[string]any{
		{"kind": "tools", "contributionId": "inspect", "configuration": map[string]any{}, "input": map[string]any{}, "context": map[string]any{"resourceHandles": map[string]string{}}},
		{"kind": "tools", "contributionId": "inspect", "configuration": map[string]any{}, "input": map[string]any{"maxFiles": 101}, "context": map[string]any{"resourceHandles": map[string]string{"workspace": "h"}}},
	} {
		if _, err := Handle(withSession(t, encode(t, request)), reader); err == nil {
			t.Fatalf("expected rejection for %#v", request)
		}
	}
	for _, result := range []map[string]any{
		{"items": nil, "truncated": false},
		{"items": []any{map[string]any{"path": "../secret", "bytes": 1}}, "truncated": false},
		{"items": []any{map[string]any{"path": "a.txt", "bytes": 1}, map[string]any{"path": "a.txt", "bytes": 1}}, "truncated": false},
		{"items": []any{map[string]any{"path": "a.txt", "bytes": uint64(9_007_199_254_740_992)}}, "truncated": false},
		{"items": []any{map[string]any{"path": "a.txt"}}, "truncated": false},
		{"items": []any{map[string]any{"bytes": 1}}, "truncated": false},
		{"items": []any{map[string]any{"path": "a.txt", "bytes": 1.5}}, "truncated": false},
		{"items": []any{}, "truncated": "false"},
	} {
		if _, _, err := readInventory(encode(t, result), 100); err == nil {
			t.Fatalf("expected invalid inventory rejection for %#v", result)
		}
	}
	if _, _, err := readInventory(encode(t, map[string]any{"items": []any{
		map[string]any{"path": "a", "bytes": 0}, map[string]any{"path": "b", "bytes": 0},
	}, "truncated": false}), 1); err == nil {
		t.Fatal("host result above requested bound must fail closed")
	}
}
