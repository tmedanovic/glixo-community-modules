package provider

import (
	"testing"

	"github.com/glixo-community/ollama-provider-go/generated/wit/glixo_llm_types_types"
)

func TestToolCallTakesPrecedenceOverStopDoneReason(t *testing.T) {
	got := finishReason("stop", true)
	if got.Tag() != glixo_llm_types_types.FinishReasonTool {
		t.Fatalf("finishReason(stop, toolCallsSeen) tag = %d, want tool", got.Tag())
	}
}

func TestFinishReasonWithoutToolCallsPreservesOllamaReason(t *testing.T) {
	tests := []struct {
		reason string
		want   uint8
	}{{"stop", glixo_llm_types_types.FinishReasonStop}, {"length", glixo_llm_types_types.FinishReasonLength}}
	for _, test := range tests {
		if got := finishReason(test.reason, false).Tag(); got != test.want {
			t.Errorf("finishReason(%q, false) tag = %d, want %d", test.reason, got, test.want)
		}
	}
}
