package export_glixo_contribution_guest

import (
	"github.com/glixo-community/glixo-contribution-guest-go/internal/workflowtextstats"
	types "go.bytecodealliance.org/pkg/wit/types"
)

// docs:snippet-start workflow-text-stats-guest:go
func Invoke(requestJSON string) types.Result[string, string] {
	output, err := workflowtextstats.Handle(requestJSON)
	if err != nil {
		return types.Err[string, string](stableErrorCode(err))
	}
	return types.Ok[string, string](output)
}
// docs:snippet-end workflow-text-stats-guest:go

func stableErrorCode(err error) string {
	code := err.Error()
	if code == "" || len(code) > 96 {
		return "workflow_text_stats_failed"
	}
	for _, character := range code {
		if !(character == '_' || character >= '0' && character <= '9' || character >= 'a' && character <= 'z' || character >= 'A' && character <= 'Z') {
			return "workflow_text_stats_failed"
		}
	}
	return code
}
