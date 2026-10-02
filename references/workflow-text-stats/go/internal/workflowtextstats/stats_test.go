package workflowtextstats

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestSharedGoldenCases(t *testing.T) {
	_, source, _, ok := runtime.Caller(0)
	if !ok { t.Fatal("test source path unavailable") }
	projectRoot := filepath.Clean(filepath.Join(filepath.Dir(source), "..", ".."))
	paths := []string{
		filepath.Join(projectRoot, "..", "..", "_shared", "goldens", "workflow-text-stats", "cases.json"),
		filepath.Join(projectRoot, "shared", "goldens", "workflow-text-stats", "cases.json"),
	}
	var data []byte
	for _, path := range paths { if candidate, err := os.ReadFile(path); err == nil { data = candidate; break } }
	if data == nil { t.Fatal("shared workflow-text-stats cases.json was not found") }
	var fixture struct {
		Cases []struct {
			ID string `json:"id"`
			Request json.RawMessage `json:"request"`
			Expected Result `json:"expectedResponse"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(data, &fixture); err != nil { t.Fatal(err) }
	for _, item := range fixture.Cases {
		t.Run(item.ID, func(t *testing.T) {
			actualJSON, err := Handle(string(item.Request))
			if err != nil { t.Fatal(err) }
			var actual Result
			if err := json.Unmarshal([]byte(actualJSON), &actual); err != nil { t.Fatal(err) }
			if actual != item.Expected { t.Fatalf("got %#v, want %#v", actual, item.Expected) }
		})
	}
}

func TestUnicodeScalarsAndWhitespace(t *testing.T) {
	result, err := Analyze("A  🧭é", true, 1)
	if err != nil || result != (Result{WordCount: 2, CharacterCount: 6}) {
		t.Fatalf("default Unicode counts: got %#v, err %v", result, err)
	}
}

func TestMinimumLengthAndWhitespaceExclusion(t *testing.T) {
	result, err := Analyze("A wide 🧭é\n!", false, 2)
	if err != nil || result != (Result{WordCount: 2, CharacterCount: 9}) {
		t.Fatalf("filtered Unicode counts: got %#v, err %v", result, err)
	}
}

func TestEmptyAndInvalidBounds(t *testing.T) {
	result, err := Analyze("", true, 1)
	if err != nil || result != (Result{}) {
		t.Fatalf("empty text: got %#v, err %v", result, err)
	}
	if _, err := Analyze("x", true, 0); err == nil {
		t.Fatal("minimum word length below 1 was accepted")
	}
}
