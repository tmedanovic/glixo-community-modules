package export_glixo_contribution_guest

import (
	"errors"

	"github.com/glixo-community/glixo-contribution-guest-go/generated/wit/glixo_contribution_broker"
	"github.com/glixo-community/glixo-contribution-guest-go/internal/workspacehealth"
	"github.com/glixo/extension-sdk-go/workspace"
	types "go.bytecodealliance.org/pkg/wit/types"
)

type hostWorkspace struct{}

func (hostWorkspace) Search(handle, query string, limit uint32) (string, error) {
	result := glixo_contribution_broker.WorkspaceSearch(handle, query, limit)
	if result.Tag() == types.ResultErr {
		return "", errors.New(result.Err())
	}
	return result.Ok(), nil
}

func (hostWorkspace) Read(handle, path string, maxBytes uint32) (string, error) {
	result := glixo_contribution_broker.WorkspaceRead(handle, path, maxBytes)
	if result.Tag() == types.ResultErr {
		return "", errors.New(result.Err())
	}
	return result.Ok(), nil
}

var _ workspace.Reader = hostWorkspace{}

func Invoke(requestJSON string) types.Result[string, string] {
	output, err := workspacehealth.Handle(requestJSON, hostWorkspace{})
	if err != nil {
		return types.Err[string, string](stableErrorCode(err))
	}
	return types.Ok[string, string](output)
}

func stableErrorCode(err error) string {
	code := err.Error()
	if code == "" || len(code) > 96 {
		return "workspace_health_failed"
	}
	for _, character := range code {
		if !(character == '_' || character >= '0' && character <= '9' || character >= 'a' && character <= 'z' || character >= 'A' && character <= 'Z') {
			return "workspace_health_failed"
		}
	}
	return code
}
