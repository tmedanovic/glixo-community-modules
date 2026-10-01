package documentindex

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"testing"

	"github.com/glixo/extension-sdk-go/workspace"
)

type fakeWorkspace struct {
	searchResult string
	readResults  map[string]string
	searchCalls  []searchCall
	readCalls    []readCall
}

type searchCall struct {
	handle string
	query  string
	limit  uint32
}
type readCall struct {
	handle   string
	path     string
	maxBytes uint32
}

func (f *fakeWorkspace) Search(handle, query string, limit uint32) (string, error) {
	f.searchCalls = append(f.searchCalls, searchCall{handle, query, limit})
	return f.searchResult, nil
}

func (f *fakeWorkspace) Read(handle, path string, maxBytes uint32) (string, error) {
	f.readCalls = append(f.readCalls, readCall{handle, path, maxBytes})
	return f.readResults[path], nil
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

func request(t *testing.T, input map[string]any, handles map[string]string) string {
	t.Helper()
	return withSession(t, encode(t, map[string]any{
		"kind": "dataSources", "contributionId": "search", "configuration": map[string]any{}, "input": input,
		"context": map[string]any{"resourceHandles": handles},
	}))
}

func TestGoldenPathSearchSortsAndUsesSelectedHandle(t *testing.T) {
	var fixture map[string]json.RawMessage
	data, err := os.ReadFile(fixturePath(t, filepath.Join("document-index", "path-substring.json")))
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(data, &fixture); err != nil {
		t.Fatal(err)
	}
	var query string
	var limit int
	var hostReads map[string]string
	if err := json.Unmarshal(fixture["query"], &query); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(fixture["limit"], &limit); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(fixture["hostReadResults"], &hostReads); err != nil {
		t.Fatal(err)
	}
	reader := &fakeWorkspace{searchResult: string(fixture["hostSearchResult"]), readResults: hostReads}
	actual, err := Handle(request(t, map[string]any{"query": query, "limit": limit}, map[string]string{"workspace": "opaque-selected"}), reader)
	if err != nil {
		t.Fatal(err)
	}
	var response map[string]any
	if err := json.Unmarshal([]byte(actual), &response); err != nil {
		t.Fatal(err)
	}
	var expectedPaths []string
	if err := json.Unmarshal(fixture["expectedPaths"], &expectedPaths); err != nil {
		t.Fatal(err)
	}
	var actualPaths []string
	for _, row := range response["items"].([]any) {
		actualPaths = append(actualPaths, row.(map[string]any)["path"].(string))
	}
	if !reflect.DeepEqual(actualPaths, expectedPaths) || response["truncated"] != false {
		t.Fatalf("unexpected golden paths/truncation: %#v", response)
	}
	if !reflect.DeepEqual(reader.searchCalls, []searchCall{{handle: "opaque-selected", query: "docs/", limit: 3}}) {
		t.Fatalf("unexpected search call: %#v", reader.searchCalls)
	}
	if !reflect.DeepEqual(reader.readCalls, []readCall{
		{handle: "opaque-selected", path: "docs/api.md", maxBytes: 4096},
		{handle: "opaque-selected", path: "docs/guide.md", maxBytes: 4096},
	}) {
		t.Fatalf("unexpected bounded reads: %#v", reader.readCalls)
	}
}

func TestBoundsReadsAndCutsUTF8ExcerptByBytes(t *testing.T) {
	reader := &fakeWorkspace{
		searchResult: encode(t, map[string]any{"items": []any{
			map[string]any{"path": "z/big.txt", "bytes": 4097},
			map[string]any{"path": "a/small.txt", "bytes": 4},
		}, "truncated": true}),
		readResults: map[string]string{"a/small.txt": "a€"},
	}
	resultJSON, err := Handle(request(t, map[string]any{"query": "small", "excerptBytes": 2}, map[string]string{"workspace": "opaque-1"}), reader)
	if err != nil {
		t.Fatal(err)
	}
	var response map[string]any
	if err := json.Unmarshal([]byte(resultJSON), &response); err != nil {
		t.Fatal(err)
	}
	rows := response["items"].([]any)
	first := rows[0].(map[string]any)
	second := rows[1].(map[string]any)
	if first["path"] != "a/small.txt" || first["excerpt"] != "a" || first["excerptTruncated"] != true {
		t.Fatalf("excerpt split a multibyte sequence or missed byte limit: %#v", first)
	}
	if second["path"] != "z/big.txt" || second["excerpt"] != nil || second["excerptTruncated"] != true {
		t.Fatalf("large item should not be read: %#v", second)
	}
	if response["truncated"] != true {
		t.Fatal("host truncation must be preserved")
	}
	if !reflect.DeepEqual(reader.readCalls, []readCall{{handle: "opaque-1", path: "a/small.txt", maxBytes: 4096}}) {
		t.Fatalf("reads exceeded policy: %#v", reader.readCalls)
	}
}

func TestMissingHandleInvalidQueryAndLimitsFailClosed(t *testing.T) {
	reader := &fakeWorkspace{searchResult: encode(t, map[string]any{"items": []any{}, "truncated": false}), readResults: map[string]string{}}
	for _, test := range []struct {
		input   map[string]any
		handles map[string]string
	}{
		{map[string]any{"query": "x"}, map[string]string{}},
		{map[string]any{"query": "  "}, map[string]string{"workspace": "h"}},
		{map[string]any{"query": strings.Repeat("x", 129)}, map[string]string{"workspace": "h"}},
		{map[string]any{"query": "x", "limit": 21}, map[string]string{"workspace": "h"}},
		{map[string]any{"query": "x", "excerptBytes": 97}, map[string]string{"workspace": "h"}},
	} {
		if _, err := Handle(request(t, test.input, test.handles), reader); err == nil {
			t.Fatalf("expected rejection for input %#v", test.input)
		}
	}
}

func TestRejectsUnsafePathsDuplicateResultsAndOversizedRead(t *testing.T) {
	invalidInventories := []map[string]any{
		{"items": []any{map[string]any{"path": "../secret", "bytes": 1}}, "truncated": false},
		{"items": []any{map[string]any{"path": "a", "bytes": 1}, map[string]any{"path": "a", "bytes": 1}}, "truncated": false},
		{"items": []any{map[string]any{"path": "a", "bytes": 1}, map[string]any{"path": "b", "bytes": 1}}, "truncated": false},
	}
	for index, inventory := range invalidInventories {
		limit := 1
		if index < 2 {
			limit = 10
		}
		if _, _, err := readInventory(encode(t, inventory), limit); err == nil {
			t.Fatalf("expected rejected inventory %#v", inventory)
		}
	}
	reader := &fakeWorkspace{
		searchResult: encode(t, map[string]any{"items": []any{map[string]any{"path": "large.txt", "bytes": 10}}, "truncated": false}),
		readResults:  map[string]string{"large.txt": strings.Repeat("x", 4097)},
	}
	if _, err := Handle(request(t, map[string]any{"query": "large"}, map[string]string{"workspace": "h"}), reader); err == nil {
		t.Fatal("read result above the broker's byte cap must be rejected")
	}
}

func TestQueryLengthMatchesUTF16Contract(t *testing.T) {
	query := strings.Repeat("x", 126) + "😀"
	if utf16Length(query) != 128 {
		t.Fatal("supplementary characters must match TypeScript and C# string length")
	}
	if _, err := Handle(request(t, map[string]any{"query": query + "x"}, map[string]string{"workspace": "h"}), &fakeWorkspace{}); err == nil {
		t.Fatal("query longer than 128 UTF-16 code units must be rejected")
	}
}
